'use strict';

/*
 * #12 step 1: every cached DOM lookup lives in renderer/dom-refs.js.
 *
 * The point of pulling `els` out is not line count, it is that all 165 top-level functions in app.js
 * reach into one object, so every later boundary (storage, cron, tree, settings, composer, transcript)
 * has to answer "what does this area do with els" before it can move. With the object in its own file,
 * that question has an answer a test can check:
 *
 *   - the declarations are in dom-refs.js and nowhere else (a second copy drifts silently),
 *   - index.html loads dom-refs.js BEFORE app.js, because the block runs at load time and `$('id')`
 *     returns null for a script that loaded too early - a null in els is a click handler that never
 *     fires, which is the kind of bug that only shows up when someone tries to use the button,
 *   - every `els.<name>` the code reads is actually declared, so deleting or renaming a key cannot
 *     survive review,
 *   - the packaged app still ships the file (build.files must keep covering renderer/**).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const READER_DIR = path.join(ROOT, 'renderer');

function read(name) {
  return fs.readFileSync(path.join(READER_DIR, name), 'utf8');
}

function elsBlock(source) {
  const start = source.indexOf('const els = {');
  if (start === -1) return null;
  const end = source.indexOf('\n};', start);
  assert.notEqual(end, -1, 'the els block must be closed at column 0');
  return source.slice(start, end + 3);
}

test('the DOM lookups are declared once, in dom-refs.js', () => {
  const refs = read('dom-refs.js');
  const app = read('app.js');
  assert.match(refs, /^const els = \{/m);
  assert.match(refs, /^const \$ = \(id\) => document\.getElementById\(id\);$/m);
  assert.ok(!/^const els = \{/m.test(app), 'els must not be declared in app.js as well: two copies drift');
  assert.ok(!/^const \$ = /m.test(app), '$ must not be declared in app.js as well');
});

test('index.html loads dom-refs.js before app.js', () => {
  const html = fs.readFileSync(path.join(READER_DIR, 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(order.includes('dom-refs.js'), 'the packaged page must load the new file');
  assert.ok(order.indexOf('dom-refs.js') < order.indexOf('app.js'), 'els is built at load time: loading it after app.js leaves every lookup null');
  // the page is the only thing that decides load order, so a script tag added by hand to app.js is a bug
  assert.ok(!/loadScriptOnce\(['"]dom-refs\.js/.test(read('app.js')), 'dom-refs.js must not be lazy-loaded: app.js reads els while it is starting up');
});

test('every els.<name> the code reads is declared', () => {
  const refs = read('dom-refs.js');
  const block = elsBlock(refs);
  assert.ok(block, 'dom-refs.js must declare the els block');
  const declared = new Set([...block.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]));
  assert.ok(declared.size >= 40, `expected the cached lookups to be a real inventory, found ${declared.size}`);

  const used = new Set();
  for (const file of ['app.js', 'smoke.js', 'dom-refs.js']) {
    for (const m of read(file).matchAll(/\bels\.([A-Za-z0-9_]+)/g)) used.add(m[1]);
  }
  const missing = [...used].filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], 'a lookup nobody declared is undefined at runtime, and the code that touches it fails only when that control is used');

  // dynamic access would be invisible to the check above; if someone adds it, this test has to be told
  const dynamic = [...read('app.js').matchAll(/\bels\[/g)];
  assert.equal(dynamic.length, 0, 'els[name] hides a lookup from this test: enumerate it instead');
});

test('the packaged app still ships every script the page loads', () => {
  const build = require(path.join(ROOT, 'package.json')).build;
  assert.ok(build.files.includes('renderer/**'), 'build.files must keep covering renderer/** or an installed app loses a script and shows a blank window');
  const html = fs.readFileSync(path.join(READER_DIR, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) {
    assert.ok(fs.existsSync(path.join(READER_DIR, m[1])), `${m[1]} is loaded by the page but does not exist`);
  }
});
