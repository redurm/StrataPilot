'use strict';

/*
 * The Markdown Viewer handoff (T3 of the markdown work): the logic lives in lib/md-viewer.js so it can be
 * tested without Electron, and the wiring is asserted from the source because the code it exercises only
 * runs inside the window (the same reason lint-structure exists, #5).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const mdViewer = require('../lib/md-viewer');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function tempDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mdview-${name}-`));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/* ---- the name a message becomes ---- */

test('a message title cannot escape the handoff folder', () => {
  const dir = tempDir('escape');
  const attacks = ['..\\..\\windows\\system32\\evil', '../../../../etc/passwd', 'C:\\Windows\\notepad.exe', '...', '....md'];
  for (const attack of attacks) {
    const name = mdViewer.viewerFileName(attack);
    assert.equal(path.basename(name), name, `a name must never carry a directory part: ${name}`);
    assert.ok(!/[\\/]/.test(name), `a separator survived: ${name}`);
    assert.ok(!name.startsWith('.'), `a name may not start with a dot: ${name}`);
    const wrote = mdViewer.writeDocument({ dir, name: attack, text: 'x' });
    assert.equal(wrote.ok, true, wrote.error);
    assert.equal(path.dirname(wrote.path), dir, `${attack} wrote outside the handoff folder: ${wrote.path}`);
  }
});

test('twenty handoffs with the same title still get their own file, then a stamp', () => {
  const dir = tempDir('stamp');
  const seen = new Set();
  for (let i = 0; i < 22; i++) {
    const name = mdViewer.uniqueName(dir, 'same.md', (target) => fs.existsSync(target));
    fs.writeFileSync(path.join(dir, name), String(i));
    seen.add(name);
  }
  assert.equal(seen.size, 22, `collisions: ${[...seen].join(', ')}`);
  assert.ok([...seen].some((name) => /same-\d+\.md/.test(name)));
});

test('CJK, spaces and markdown punctuation survive, control characters do not', () => {
  assert.equal(mdViewer.viewerFileName('重構 renderer 的 #44 問題'), '重構 renderer 的 #44 問題.md');
  assert.equal(mdViewer.viewerFileName('title   with    spaces'), 'title with spaces.md');
  assert.equal(mdViewer.viewerFileName('trailing dots...'), 'trailing dots.md');
  assert.equal(mdViewer.viewerFileName('a' + String.fromCharCode(0) + 'b' + String.fromCharCode(9) + 'c'), 'a b c.md');
  assert.equal(mdViewer.viewerFileName('a' + String.fromCharCode(9) + 'b'), 'a b.md');
  assert.equal(mdViewer.viewerFileName(''), 'message.md');
  assert.equal(mdViewer.viewerFileName(null), 'message.md');
  assert.ok(mdViewer.viewerFileName('x'.repeat(200)).length <= mdViewer.NAME_MAX + 3);
});

/* ---- the file itself ---- */

test('writeDocument writes utf8 into the folder it is given and reports what it wrote', () => {
  const dir = tempDir('write');
  const res = mdViewer.writeDocument({ dir, name: '標題', text: '# 標題\n\n內文' });
  assert.equal(res.ok, true, res.error);
  assert.equal(path.dirname(res.path), dir);
  assert.equal(fs.readFileSync(res.path, 'utf8'), '# 標題\n\n內文\n');
  assert.ok(res.bytes > 0 && !res.truncated);
});

test('an empty message is refused rather than opened as an empty window', () => {
  const dir = tempDir('empty');
  for (const text of ['', '   ', '\n\n', null, undefined, 42]) {
    const res = mdViewer.writeDocument({ dir, name: 'x', text });
    assert.equal(res.ok, false, `should refuse: ${JSON.stringify(text)}`);
  }
  assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.md')).length, 0);
});

test('a second message with the same title gets its own file (the viewer must not show a stale one)', () => {
  const dir = tempDir('unique');
  const first = mdViewer.writeDocument({ dir, name: 'same', text: 'one' });
  const second = mdViewer.writeDocument({ dir, name: 'same', text: 'two' });
  assert.notEqual(first.path, second.path);
  assert.equal(fs.readFileSync(second.path, 'utf8'), 'two\n');
  assert.equal(fs.readFileSync(first.path, 'utf8'), 'one\n');
});

test('an over-long answer is cut at the cap, without splitting a character', () => {
  const dir = tempDir('cap');
  const text = '漢字abc'.repeat(5000); // multi-byte on purpose: the cap is a BYTE cap
  const res = mdViewer.writeDocument({ dir, name: 'big', text, capBytes: 256 });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.truncated, true);
  assert.ok(res.bytes <= 256, String(res.bytes));
  const written = fs.readFileSync(res.path, 'utf8');
  assert.ok(!written.includes('\uFFFD'), 'the cut must not leave a replacement character');
  assert.ok(text.startsWith(written.trim()), 'the copy must be a real prefix of the answer');
});

test('handoff files older than the keep window are pruned, fresh ones and foreign files are not', () => {
  const dir = tempDir('prune');
  const old = path.join(dir, 'old.md');
  const fresh = path.join(dir, 'fresh.md');
  const other = path.join(dir, 'keep.txt');
  for (const file of [old, fresh, other]) fs.writeFileSync(file, 'x');
  const past = Date.now() - (mdViewer.KEEP_MS + 60000);
  fs.utimesSync(old, new Date(past), new Date(past));
  const res = mdViewer.pruneOld(dir);
  assert.equal(res.removed, 1, JSON.stringify(res));
  assert.ok(!fs.existsSync(old), 'the aged file should be gone');
  assert.ok(fs.existsSync(fresh), 'a fresh handoff must survive');
  assert.ok(fs.existsSync(other), 'the folder is ours, but a non-handoff file is not ours to delete');
});

test('pruneOld on a folder that does not exist yet is not an error', () => {
  const res = mdViewer.pruneOld(path.join(tempDir('nopipe'), 'not-created-yet'));
  assert.deepEqual(res, { removed: 0, kept: 0 });
});

/* ---- which program opens it ---- */

test('the settings entry wins over the environment, and both beat the system default', () => {
  const exists = (target) => target === 'C:\\MarkdownViewer\\MarkdownViewer.exe' || target === 'D:\\other.exe';
  const fromSettings = mdViewer.resolveViewer({
    setting: 'C:\\MarkdownViewer\\MarkdownViewer.exe',
    env: 'D:\\other.exe',
    exists,
  });
  assert.equal(fromSettings.kind, 'exe');
  assert.equal(fromSettings.path, 'C:\\MarkdownViewer\\MarkdownViewer.exe');
  assert.equal(fromSettings.from, 'markdownViewerPath');
  const fromEnv = mdViewer.resolveViewer({ setting: '', env: 'D:\\other.exe', exists });
  assert.equal(fromEnv.path, 'D:\\other.exe');
  assert.equal(fromEnv.from, 'STRATAPILOT_MD_VIEWER');
  assert.deepEqual(mdViewer.resolveViewer({ setting: '', env: '', exists: () => false }), { kind: 'default' });
  assert.deepEqual(mdViewer.resolveViewer({}), { kind: 'default' });
});

test('a configured viewer that no longer exists is reported, not quietly replaced', () => {
  // silently falling back to Notepad is how "the diagram opened a wall of text" becomes a support ticket
  const res = mdViewer.resolveViewer({ setting: 'C:\\gone\\MarkdownViewer.exe', env: '', exists: () => false });
  assert.equal(res.kind, 'missing');
  assert.equal(res.path, 'C:\\gone\\MarkdownViewer.exe');
});

/* ---- the wiring, which no unit test can execute ---- */

test('the channel is registered in main, bound in preload, and called from the renderer', () => {
  const main = read('main.js');
  const preload = read('preload.js');
  const app = read('renderer/app.js');
  assert.match(main, /ipcMain\.handle\('md:open-viewer'/, 'main.js must register the channel');
  assert.match(main, /require\('\.\/lib\/md-viewer'\)/, 'main.js must use the lib, not an inline copy');
  assert.match(main, /process\.env\.STRATAPILOT_MD_VIEWER/, 'the environment lever must be read in main, not the window');
  assert.match(preload, /openMarkdown: \(payload = \{\}\) => ipcRenderer\.invoke\('md:open-viewer'/, 'preload binding');
  const calls = (app.match(/api\.openMarkdown\(/g) || []).length;
  assert.equal(calls, 1, `the preload binding needs exactly one caller, found ${calls} (#28)`);
});

test('a viewer button exists for diagrams and for whole answers, and both are handled', () => {
  const markdown = read('renderer/markdown.js');
  assert.match(markdown, /data-viewer/, 'a mermaid fence needs the button');
  assert.match(markdown, /lang === 'mermaid'/, 'and only for a block this app cannot draw');
  const transcript = read('renderer/transcript.js');
  assert.match(transcript, /dataset\.msgAction = 'viewer'/, 'an assistant message needs the button');
  const app = read('renderer/app.js');
  assert.match(app, /closest\('\[data-viewer\]'\)/, 'the fence button needs a delegated handler');
  assert.match(app, /fenceFor\(/, 'the wrapper around a copied block must be sized to what it contains');
  assert.match(app, /msgAction === 'viewer'/, 'the message button needs its branch');
  assert.match(app, /function openInMarkdownViewer/, 'one place decides what a handoff does');
});

test('the settings dialog exposes the viewer path (the same key main reads)', () => {
  const settings = read('renderer/settings.js');
  assert.match(settings, /textRow\('markdownViewerPath'/, 'the dialog must write the key');
  assert.match(read('main.js'), /loadSettings\(\)\.markdownViewerPath/, 'main must read that same key');
});
