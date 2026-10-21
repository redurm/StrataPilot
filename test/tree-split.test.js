'use strict';

/*
 * #12 step 3: the session tree lives in renderer/tree.js.
 *
 * Same shape as step 2. The cross-script duplicate-declaration guard is NOT repeated here:
 * test/storage-split.test.js scans every renderer/*.js, so a name declared twice is caught no matter
 * which pair of files it happens between. What is pinned here is the boundary itself and the load
 * order, which is the part that fails as a dead window rather than a failing test.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const READER = path.join(__dirname, '..', 'renderer');
const read = (name) => fs.readFileSync(path.join(READER, name), 'utf8');

const MOVED = ['treeKind', 'treeText', 'indexTree', 'flattenTree', 'findItemForEntry', 'openSessionTree'];

test('the session tree functions are declared in tree.js, not in app.js', () => {
  const moved = read('tree.js');
  const app = read('app.js');
  for (const name of MOVED) {
    const decl = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
    assert.ok(decl.test(moved), `${name} should live in renderer/tree.js`);
    assert.ok(!decl.test(app), `${name} is declared in both files: two copies drift apart`);
  }
});

test('the page loads tree.js before app.js, and nothing lazy-loads it', () => {
  const html = read('index.html');
  const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(order.includes('tree.js'), 'the packaged page must load the new file');
  assert.ok(order.indexOf('tree.js') < order.indexOf('app.js'), 'load it before app.js');
  for (const file of ['app.js', 'smoke.js']) {
    assert.ok(!/loadScriptOnce\(['"]tree\.js/.test(read(file)), `${file} must not lazy-load tree.js`);
  }
});

test('tree.js declares nothing that runs at load time except declarations', () => {
  // step 2: a top-level table built with i18nKey() in a script that loads before app.js kills the
  // window with a ReferenceError, node --check is happy, and only the smoke log notices.
  const lines = read('tree.js').split(/\r?\n/);
  const statements = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || /^[ \t})/*]/.test(line)) continue;
    if (/^(?:async )?function /.test(line)) continue;
    if (/^'use strict';$/.test(line)) continue;
    statements.push(`${i + 1}: ${line.slice(0, 60)}`);
  }
  assert.deepEqual(statements, [], 'a load-time statement in tree.js runs before app.js exists: keep it in app.js');
});
