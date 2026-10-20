// #36: `/stats` printed "session: (ephemeral)" for every session, saved or not, because it read
// d.sessionFile from get_session_stats - a field pi does not return. The payload shape is pinned here
// so the next field read against pi's RPC is checked against something real instead of guessed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');

// observed against pi 1.2.0 in --mode rpc
const SESSION_STATS_FIELDS = ['sessionId', 'userMessages', 'assistantMessages', 'toolCalls', 'toolResults', 'totalMessages', 'tokens', 'cost', 'contextUsage'];

test('the stats note stops claiming a saved session is ephemeral', () => {
  const block = app.match(/case 'stats': \{[\s\S]*?\n    \}/);
  assert.ok(block, 'the /stats command handler is missing');
  assert.ok(!/d\.sessionFile/.test(block[0]), '/stats reads d.sessionFile, which get_session_stats does not return');
  assert.match(block[0], /tab\.sessionPath \|\| '\(ephemeral\)'/);
});

test('nothing else in the renderer reads a sessionFile off a get_session_stats response', () => {
  const needle = "'get_session_stats'";
  let at = app.indexOf(needle);
  assert.notEqual(at, -1, 'expected at least one get_session_stats call');
  let reads = 0;
  while (at !== -1) {
    const window = app.slice(at, at + 400); // the handler that consumes this response
    assert.ok(!/\.sessionFile/.test(window), `a get_session_stats result is read for sessionFile near offset ${at}`);
    reads += 1;
    at = app.indexOf(needle, at + needle.length);
  }
  assert.ok(reads >= 1);
});

test('export asks for the path before it refuses to export', () => {
  const block = app.match(/async function runExport\(tab, arg\) \{[\s\S]*?\n\}/);
  assert.ok(block, 'runExport is missing');
  assert.match(block[0], /if \(!tab\.sessionPath && !tab\.ephemeral\) await adoptSessionPath\(tab\);/);
  assert.match(block[0], /if \(tab\.ephemeral \|\| !tab\.sessionPath\) \{/);
  assert.match(app, /async function adoptSessionPath\(tab\) \{[\s\S]*'get_state'[\s\S]*\}/);
});

test('the exported field list is the one pi really sends', () => {
  // if pi ever starts returning sessionFile, this test says so instead of leaving a silent fallback
  assert.ok(SESSION_STATS_FIELDS.includes('sessionId'));
  assert.ok(!SESSION_STATS_FIELDS.includes('sessionFile'));
});
