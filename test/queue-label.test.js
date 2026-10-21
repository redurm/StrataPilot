'use strict';

/*
 * Regression test for the queue row's screen-reader text (D3).
 *
 * `renderer/app.js` is a browser script - it touches the DOM as it loads, so it cannot be required.
 * `describeQueueRow()` is the one part of the queue that is pure string work, and it is also the part
 * that once took the whole window down: the local holding the status word was named `state`, which hid
 * the module-level `state` (the object that owns `order`), so `state.order.length` read a property of
 * `undefined`. It threw on every row in the Working group, which emptied the tab strip and the queue
 * and lost the message being sent.
 *
 * So: pull the function's source out of the file and run it against stubs. No Electron, no DOM.
 * The stub `state` deliberately has three open tabs while only two are working - a leftover
 * `state.order.length` would print "of 3" and fail the assertion instead of throwing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// D10: describeQueueRow now translates; the shared core's English translator is the identity that
// still fills {placeholders}, which is what these assertions are about
const { makeT } = require(path.join('..', 'renderer', 'i18n.js'));

const appSource = ['renderer/app.js', 'renderer/composer.js', 'renderer/transcript.js', 'renderer/monitor.js', 'renderer/chrome.js']
  .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))
  .join(String.fromCharCode(10));

/** Return the text of a top-level `function name(...) { ... }` in the renderer source. */
function functionSource(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `renderer/app.js or composer.js no longer defines ${name}()`);
  const open = appSource.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < appSource.length; i++) {
    if (appSource[i] === '{') depth++;
    else if (appSource[i] === '}' && --depth === 0) return appSource.slice(start, i + 1);
  }
  throw new Error(`${name}() has unbalanced braces`);
}

function loadDescribeQueueRow() {
  const body = functionSource('describeQueueRow');
  // the names the function closes over in the browser become parameters here; tr() is D10's translate
  // helper, and the identity translator keeps these assertions in English
  const factory = new Function('tabLabel', 'scheduler', 'state', 'tr', `${body}; return describeQueueRow;`);
  const state = { order: ['a', 'b', 'c'] }; // three tabs open...
  const scheduler = { runningTabId: 'a' }; // ...only two of them working
  return factory((tab) => tab.name, scheduler, state, makeT(null, 'en').t);
}

const describeQueueRow = loadDescribeQueueRow();

test('a working row says what it is doing and counts itself out of the working group', () => {
  const running = { id: 'a', name: 'alpha', isStreaming: true, outbox: [] };
  assert.equal(
    describeQueueRow(running, 1, 2),
    'alpha, running, queue position 1 of 2. Alt+Up or Alt+Down reorders it.',
  );

  const queued = { id: 'b', name: 'beta', isStreaming: false, outbox: [{ text: 'one' }, { text: 'two' }] };
  assert.equal(
    describeQueueRow(queued, 2, 2),
    'beta, queued, 2 pending, queue position 2 of 2. Alt+Up or Alt+Down reorders it.',
  );
});

test('an idle row admits it is not in the queue', () => {
  const idle = { id: 'c', name: 'gamma', isStreaming: false, outbox: [] };
  assert.equal(describeQueueRow(idle, 0, 2), 'gamma, idle, not in the queue. Alt+Up or Alt+Down reorders it.');
});

test('the queue passes the working count down to the row it renders', () => {
  // queueRow has to take the total as well as the position, and renderOpenSessions has to hand it the
  // size of the working group rather than the size of the tab list
  assert.match(appSource, /function queueRow\(tab, position, workingCount\)/);
  assert.match(appSource, /describeQueueRow\(tab, position, workingCount\)/);
  assert.match(appSource, /queueRow\(tab, index \+ 1, working\.length\)/);
});
