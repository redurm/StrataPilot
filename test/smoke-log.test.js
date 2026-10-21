'use strict';

/*
 * The CI log checker (#47). A smoke run that ended early looks exactly like a run that passed unless
 * something counts the lines each scenario owes, so the counting itself needs tests: a checker that is
 * always green is worse than no checker, because it teaches everyone to ignore it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkSmokeLog, FAILURE_PATTERNS, TALLY_RE } = require('../scripts/check-smoke-log');
const { safeScenarioTags } = require('../lib/smoke-flags');

const CLEAN = [
  '[smoke-autocompact] boot=true now=true',
  '[smoke-diag] ok=true report=1',
  '[smoke-storage] ok=true files=3 open_in_list=false',
  '[smoke-scenarios] tally ran=3/3 crashed=0 fail_lines=0',
].join('\n');

test('a clean run with its tally passes', () => {
  assert.deepEqual(checkSmokeLog(CLEAN, ['smoke-diag']), []);
});

test('a scenario printing FAIL fails the build', () => {
  const log = CLEAN + '\n[smoke-export] ok=false FAIL the exported HTML is missing or empty';
  const problems = checkSmokeLog(log, []);
  assert.ok(problems.some((problem) => problem.includes('a scenario reported FAIL')));
});

test('a run with no tally line fails: it ended before every scenario reported', () => {
  const log = '[smoke-diag] ok=true\n[smoke-storage] ok=true';
  const problems = checkSmokeLog(log, []);
  assert.ok(problems.some((problem) => problem.includes('no [smoke-scenarios] tally line')));
});

test('a tally that admits fewer scenarios finished than were queued fails', () => {
  const log = '[smoke-scenarios] tally ran=9/16 crashed=0 fail_lines=0';
  const problems = checkSmokeLog(log, []);
  assert.ok(problems.some((problem) => problem.includes('only 9 of 16 queued scenarios finished')));
});

test('a crashed scenario and counted FAIL lines both fail', () => {
  const log = '[smoke-scenarios] tally ran=14/16 crashed=2 fail_lines=3';
  const problems = checkSmokeLog(log, []);
  assert.ok(problems.some((problem) => problem.includes('2 scenario(s) threw')));
  assert.ok(problems.some((problem) => problem.includes('3 FAIL line(s)')));
});

test('a scenario that never printed its line is caught, even with a green tally', () => {
  // the queue counts a scenario as run when its promise settles; a scenario that returns early without
  // reporting leaves no line, and that is exactly what CI must not wave through
  const log = '[smoke-diag] ok=true\n[smoke-scenarios] tally ran=2/2 crashed=0 fail_lines=0';
  const problems = checkSmokeLog(log, ['smoke-diag', 'smoke-usage']);
  assert.ok(problems.some((problem) => problem.includes('no [smoke-usage] line')));
});

test('pi failing to start is a failure, not a pass with fewer things exercised', () => {
  const log = '[pi spawn tab=tab-1] failed: pi CLI not found; set STRATAPILOT_PI_CLI\n' + CLEAN;
  const problems = checkSmokeLog(log, []);
  assert.ok(problems.some((problem) => problem.includes('pi never started')));
});

test('renderer and process level errors are caught', () => {
  const cases = [
    'renderer error: Uncaught TypeError',
    'unhandledRejection: something',
    '[smoke] scenario runner failed Error',
    '[smoke] could not load smoke.js',
  ];
  for (const line of cases) {
    const problems = checkSmokeLog(`${line}\n${CLEAN}`, []);
    assert.ok(problems.length >= 1, `expected a problem for: ${line}`);
  }
});

test('the expected tags are the ones the safe set actually prints', () => {
  const tags = safeScenarioTags();
  const log = tags.map((tag) => `[${tag}] ok=true`).join('\n') + `\n[smoke-scenarios] tally ran=${tags.length}/${tags.length} crashed=0 fail_lines=0`;
  assert.deepEqual(checkSmokeLog(log, tags), []);
  // dropping one line has to be noticed
  const missing = log.split('\n').filter((line) => !line.includes('[smoke-usage]')).join('\n');
  assert.ok(checkSmokeLog(missing, tags).some((problem) => problem.includes('no [smoke-usage] line')));
});

test('the failure patterns are regexes and the tally regex matches its own format', () => {
  for (const entry of FAILURE_PATTERNS) {
    assert.ok(entry.re instanceof RegExp && typeof entry.why === 'string');
  }
  assert.ok(TALLY_RE.test('[smoke-scenarios] tally ran=1/1 crashed=0 fail_lines=0'));
  assert.ok(!TALLY_RE.test('[smoke-scenarios] tally ran=1/1'));
});

test('the word failed is not mistaken for a scenario FAIL', () => {
  // scenarios print " FAIL " deliberately; a field named failed_items must not trip the checker
  const log = '[smoke-diag] ok=true failed_items=0\n' + CLEAN;
  const problems = checkSmokeLog(log, ['smoke-diag']);
  assert.deepEqual(problems.filter((problem) => problem.includes('reported FAIL')), []);
});
