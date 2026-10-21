'use strict';

/*
 * #12 step 2: the storage and usage dialogs live in renderer/storage.js.
 *
 * The move was scripted and no function body changed, which is the rule for every step of this split:
 * if a body has to change to compile, the boundary was wrong. What a scripted move CAN get wrong is
 * invisible to node --check, and these assertions cover exactly that:
 *
 *   - the page must load storage.js before app.js (the functions are looked up by name from handlers),
 *   - a name declared at top level in two scripts is a SyntaxError that kills the whole page and shows
 *     up as a blank window, not as a failing require - no per-file syntax check can see it,
 *   - the moved code must not be lazy-loaded, because app.js opens these dialogs during startup wiring.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const READER = path.join(ROOT, 'renderer');

function read(name) {
  return fs.readFileSync(path.join(READER, name), 'utf8');
}

const MOVED = [
  'refreshStorage', 'openStorageModal', 'usageStackTotal', 'usageValueText', 'usageSegmentValues',
  'usageCostOfSummary', 'usageFootLabel', 'updateUsageFoot', 'refreshUsageSummary', 'scheduleUsageSummary',
  'usageRangeFrom', 'usageTotalsLine', 'usageBucketLine', 'usageAxisMax', 'buildUsageChart',
  'openUsageModal', 'usageTooltip',
];

test('the storage and usage functions are declared in storage.js, not in app.js', () => {
  const moved = read('storage.js');
  const app = read('app.js');
  for (const name of MOVED) {
    const decl = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
    assert.ok(decl.test(moved), `${name} should live in renderer/storage.js`);
    assert.ok(!decl.test(app), `${name} is declared in both files: two copies drift apart`);
  }
});

test('no top-level name is declared in two renderer scripts', () => {
  // classic scripts share one lexical scope: a duplicate const is a SyntaxError for the whole page,
  // and node --check on each file alone passes. This is the trap every later step will walk into.
  const seen = new Map();
  const files = fs.readdirSync(READER).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    for (const m of read(file).matchAll(/^(?:const|let|var|function|async function)\s+([A-Za-z0-9_$]+)/gm)) {
      const name = m[1];
      if (seen.has(name) && seen.get(name) !== file) {
        assert.fail(`${name} is declared at top level in both ${seen.get(name)} and ${file}: the page dies with a blank window`);
      }
      seen.set(name, file);
    }
  }
});

test('the page loads storage.js before app.js, and nothing lazy-loads it', () => {
  const html = fs.readFileSync(path.join(READER, 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(order.includes('storage.js'), 'the packaged page must load the new file');
  assert.ok(order.indexOf('storage.js') < order.indexOf('app.js'), 'load it before app.js');
  assert.ok(!/loadScriptOnce\(['"]storage\.js/.test(read('app.js')), 'storage.js must not be lazy-loaded');
  assert.ok(!/loadScriptOnce\(['"]storage\.js/.test(read('smoke.js')), 'smoke.js must not be the only thing that loads it');
});

test('the Settings dialog functions are declared in settings.js, not in app.js', () => {
  const moved = read('settings.js');
  const app = read('app.js');
  for (const name of ['applyTheme', 'openSettingsModal', 'applySettings']) {
    const decl = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
    assert.ok(decl.test(moved), `${name} should live in renderer/settings.js`);
    assert.ok(!decl.test(app), `${name} is declared in both files`);
  }
});

test('no moved script runs app.js code at load time', () => {
  // the rule step 2 taught: a top-level table built with i18nKey() (or any call into app.js) inside a
  // script that loads before app.js is a ReferenceError that kills the window, while node --check is
  // happy and every unit test is green. Benign literals are fine; a call into app.js is not.
  const appNames = new Set();
  for (const m of read('app.js').matchAll(/^(?:const|let|var|function|async function)\s+([A-Za-z0-9_$]+)/gm)) appNames.add(m[1]);
  for (const file of ['storage.js', 'tree.js', 'settings.js', 'dom-refs.js']) {
    const lines = read(file).split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line || /^[ \t})/*]/.test(line)) continue;
      if (/^(?:async )?function /.test(line)) continue;
      if (/^'use strict';$/.test(line)) continue;
      for (const m of line.matchAll(/\b([A-Za-z0-9_$]+)\s*\(/g)) {
        assert.ok(!appNames.has(m[1]), `${file}:${i + 1} calls ${m[1]}() from app.js while it loads - keep this table in app.js`);
      }
    }
  }
});

test('the composer, queue and outbox functions are declared in composer.js, not in app.js', () => {
  const moved = read('composer.js');
  const app = read('app.js');
  const names = ['renderQueueBar', 'renderComposerState', 'queueRow', 'openOutboxModal', 'restorePendingOutbox',
    'openPendingOutboxModal', 'queueBackOfWorking', 'describeQueueRow', 'clearComposer', 'abortBash', 'send',
    'resendMessage', 'abortRun', 'clearQueue', 'setAutoRetry', 'abortRetry', 'persistedOutbox'];
  for (const name of names) {
    const decl = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
    assert.ok(decl.test(moved), `${name} should live in renderer/composer.js`);
    assert.ok(!decl.test(app), `${name} is declared in both files`);
  }
  // the statements that were NOT carried over: tab drag state and the bash timer are not composer's
  for (const kept of ['let dragTabId', 'const BASH_TIMEOUT_MS']) {
    assert.ok(app.includes(kept), `${kept} belongs in app.js, not in composer.js`);
    assert.ok(!moved.includes(kept), `${kept} does not belong in composer.js`);
  }
});

test('the transcript builders live in transcript.js, and app.js keeps the state they read', () => {
  const moved = read('transcript.js');
  const app = read('app.js');
  for (const name of ['tokenLabel', 'appendPath', 'appendPreText', 'toolArgSummary', 'buildToolCard',
    'bashEntryFromMessage', 'bashFootText', 'buildBashCard', 'buildMessageActions', 'buildMessageNode',
    'buildNoteNode', 'buildItemNode', 'appendItem', 'pushNote', 'renderAll']) {
    const decl = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
    assert.ok(decl.test(moved), `${name} should live in renderer/transcript.js`);
    assert.ok(!decl.test(app), `${name} is declared in both files`);
  }
  const order = [...read('index.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(order.indexOf('transcript.js') < order.indexOf('app.js'), 'load transcript.js before app.js');
});

test('the Monitor panel lives in monitor.js, and its load-time tables stay in app.js', () => {
  const moved = read('monitor.js');
  const app = read('app.js');
  for (const name of ['renderMonitorServers', 'applyHealthDot', 'renderMonitor', 'applyMonitorWidth', 'buildMonitorCards']) {
    assert.ok(moved.includes('function ' + name + '('), `${name} should live in renderer/monitor.js`);
    assert.ok(!app.includes('function ' + name + '('), `${name} is declared in both files`);
  }
  for (const table of ['const MON_CARDS', 'const MON_STATES']) {
    assert.ok(app.includes(table), `${table} is built with i18nKey() at load time: it stays in app.js`);
    assert.ok(!moved.includes(table), `${table} does not belong in monitor.js`);
  }
  const order = [...read('index.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(order.indexOf('monitor.js') < order.indexOf('app.js'), 'load monitor.js before app.js');
});
