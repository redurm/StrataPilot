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
