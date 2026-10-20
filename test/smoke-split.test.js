// #12: the smoke scenarios used to be the tail of renderer/app.js - ~1 000 lines of test scaffolding
// that every user parsed on startup, in a file big enough that a reviewer could not tell a real defect
// from a scenario. They live in renderer/smoke.js now, loaded only when smoke mode is on. These
// assertions are what stop the old arrangement from creeping back.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const app = read('renderer/app.js');
const smoke = read('renderer/smoke.js');
const html = read('renderer/index.html');

test('the scenarios live in renderer/smoke.js and app.js defines none of them', () => {
  const inSmoke = smoke.match(/^(async )?function smoke\w+Scenario\(/gm) || [];
  const inApp = app.match(/^(async )?function smoke\w+Scenario\(/gm) || [];
  assert.ok(inSmoke.length >= 20, `smoke.js defines only ${inSmoke.length} scenarios`);
  assert.deepEqual(inApp, [], `app.js still defines scenarios: ${inApp.join(', ')}`);
});

test('smoke.js is loaded lazily, only when the app is in smoke mode', () => {
  assert.match(app, /if \(state\.info\.smoke\) \{[^}]*loadScriptOnce\('smoke\.js'\)/s);
  // a <script src> in the page would fetch and parse it for every user, which is the whole complaint
  assert.ok(!/smoke\.js/.test(html), 'index.html must not reference smoke.js');
});

test('smoke.js stays a classic script, because it reads app.js globals from the shared scope', () => {
  assert.ok(!/^\s*(import|export)\s/m.test(smoke), 'smoke.js became a module and would lose app.js scope');
  assert.ok(!/module\.exports/.test(smoke), 'smoke.js became CommonJS, which the renderer cannot load');
  assert.match(smoke, /^async function runSmokeScenarios\(\) \{/m);
});

test('scaffolding does not creep back into app.js', () => {
  const lines = app.split(/\r?\n/).filter((line) => /smoke/i.test(line));
  // 14 today: the env-bar probe, the lazy loader and its comment, and the state.info.smoke* reads
  assert.ok(lines.length <= 20, `app.js mentions smoke on ${lines.length} lines:\n${lines.join('\n')}`);
});
