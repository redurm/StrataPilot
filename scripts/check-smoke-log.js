'use strict';

/*
 * Decide whether a smoke run passed, from its log (#47).
 *
 * Scenarios report problems as log lines and keep going, and a run that ended early looks identical to
 * a run that passed unless something counts the lines each scenario owes. This is that something: CI
 * runs it, and the build fails when a scenario failed, threw, never reported, or the process logged an
 * error of its own.
 *
 *   node scripts/check-smoke-log.js <logfile> [--safe] [--expect smoke-diag]...
 *
 * --safe expects the tags of every scenario STRATAPILOT_SMOKE_SAFE turns on (lib/smoke-flags.js), so
 * adding a scenario to the safe set automatically makes CI demand its line.
 */

const fs = require('node:fs');
const path = require('node:path');

const { safeScenarioTags } = require('../lib/smoke-flags');

// A scenario printing FAIL is the intended signal; these are the ways the run itself can be broken in a
// way no scenario would report.
const FAILURE_PATTERNS = [
  { re: / FAIL/, why: 'a scenario reported FAIL' },
  { re: /renderer error/, why: 'the renderer logged an error' },
  { re: /Uncaught|uncaughtException|unhandledRejection/, why: 'an uncaught error' },
  { re: /scenario runner failed/, why: 'the scenario runner threw' },
  { re: /could not load/, why: 'a script failed to load' },
  { re: /\[pi spawn[^\]]*\] failed/, why: 'pi never started, so nothing was really exercised' },
];

const TALLY_RE = /\[smoke-scenarios\] tally ran=(\d+)\/(\d+) crashed=(\d+) fail_lines=(\d+)/;

/** Return a list of reasons the run is not a pass; empty means pass. */
function checkSmokeLog(text, expectedTags = []) {
  const problems = [];
  const lines = text.split('\n');

  for (const { re, why } of FAILURE_PATTERNS) {
    const hit = lines.find((line) => re.test(line));
    if (hit) problems.push(`${why}: ${hit.trim().slice(0, 200)}`);
  }

  const tally = text.match(TALLY_RE);
  if (!tally) {
    problems.push('no [smoke-scenarios] tally line: the run ended before every scenario reported');
  } else {
    const ran = Number(tally[1]);
    const total = Number(tally[2]);
    const crashed = Number(tally[3]);
    const failLines = Number(tally[4]);
    if (ran !== total) problems.push(`only ${ran} of ${total} queued scenarios finished`);
    if (crashed) problems.push(`${crashed} scenario(s) threw`);
    if (failLines) problems.push(`${failLines} FAIL line(s) counted by the queue`);
  }

  for (const tag of expectedTags) {
    if (!lines.some((line) => line.includes(`[${tag}]`))) {
      problems.push(`no [${tag}] line: that scenario never reported`);
    }
  }

  return problems;
}

function main(argv) {
  const file = argv[0];
  if (!file) {
    console.error('usage: node scripts/check-smoke-log.js <logfile> [--safe] [--expect tag]...');
    return 2;
  }
  const expected = [];
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--safe') expected.push(...safeScenarioTags());
    else if (argv[i] === '--expect') expected.push(argv[++i]);
  }
  const text = fs.readFileSync(file, 'utf8');
  const problems = checkSmokeLog(text, expected);
  const tally = text.match(TALLY_RE);
  console.log(`check-smoke-log: ${path.basename(file)} tally=${tally ? tally[0] : 'none'} expected_lines=${expected.length}`);
  if (!problems.length) {
    console.log('check-smoke-log: PASS');
    return 0;
  }
  for (const problem of problems) console.error(`check-smoke-log: ${problem}`);
  return 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { checkSmokeLog, FAILURE_PATTERNS, TALLY_RE };
