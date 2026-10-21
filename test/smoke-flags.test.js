'use strict';

/*
 * The smoke flag table is the contract between CI and the scenarios (#47). These tests keep it honest:
 * the safe set really is model-independent, every scenario is classified, and every scenario prints the
 * log tag the CI checker will look for.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  BOOLEAN_ENV,
  STRING_ENV,
  MODEL_INDEPENDENT,
  SCENARIO_TAGS,
  NON_SCENARIO_FLAGS,
  smokeInfoFromEnv,
  allScenarioFlags,
  safeScenarioTags,
  unknownFlagKeys,
  isOn,
} = require('../lib/smoke-flags');

const SMOKE_SRC = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'smoke.js'), 'utf8');

function scenarioBody(fnName) {
  const match = new RegExp('(?:async function|function) ' + fnName + '\\(').exec(SMOKE_SRC);
  assert.ok(match, `${fnName} is missing from renderer/smoke.js`);
  const open = SMOKE_SRC.indexOf('{', match.index + match[0].length - 1);
  let depth = 0;
  for (let i = open; i < SMOKE_SRC.length; i += 1) {
    if (SMOKE_SRC[i] === '{') depth += 1;
    else if (SMOKE_SRC[i] === '}') {
      depth -= 1;
      if (depth === 0) return SMOKE_SRC.slice(open, i);
    }
  }
  return '';
}

const TABLE = [...SMOKE_SRC.matchAll(/\{ flag: '(\w+)', label: '([\w-]+)', run: (\w+) \}/g)]
  .map((m) => ({ flag: m[1], label: m[2], fn: m[3] }));

test('the scenario table in renderer/smoke.js is populated', () => {
  assert.ok(TABLE.length >= 20, `expected the full table, found ${TABLE.length} entries`);
});

test('every env flag names something real, and every scenario flag has a log tag', () => {
  assert.deepEqual(unknownFlagKeys(), [], 'an env flag that matches nothing is a flag that silently does nothing');
  for (const flag of allScenarioFlags()) {
    assert.ok(SCENARIO_TAGS[flag], `${flag} has no log tag, so CI could not tell it never ran`);
  }
  for (const flag of NON_SCENARIO_FLAGS) {
    assert.ok(BOOLEAN_ENV.some(([, key]) => key === flag), `${flag} is listed as non-scenario but has no env flag`);
  }
});

test('every scenario in the table is classified as safe or model-dependent', () => {
  const flags = allScenarioFlags();
  for (const entry of TABLE) {
    assert.ok(flags.includes(entry.flag), `${entry.flag} is in the table but not in the env table`);
  }
  for (const flag of MODEL_INDEPENDENT) {
    assert.ok(flags.includes(flag), `MODEL_INDEPENDENT names ${flag}, which does not exist`);
  }
  // nothing may sit outside both sets: that scenario would never run anywhere
  const modelDependent = flags.filter((flag) => !MODEL_INDEPENDENT.includes(flag));
  assert.equal(flags.length, MODEL_INDEPENDENT.length + modelDependent.length);
  for (const flag of modelDependent) assert.ok(SCENARIO_TAGS[flag], `${flag} needs a tag too`);
});

test('a scenario nothing runs is a bug: the table and the flag list must agree', () => {
  assert.deepEqual(TABLE.map((entry) => entry.flag).sort(), allScenarioFlags().sort());
});

test('each scenario prints the tag CI will look for', () => {
  for (const entry of TABLE) {
    const tag = SCENARIO_TAGS[entry.flag];
    assert.ok(tag, `${entry.flag} has no tag`);
    const body = scenarioBody(entry.fn);
    assert.ok(body.includes(`[${tag}]`), `${entry.fn} never prints [${tag}]`);
  }
});

test('the safe set never types a real prompt into the composer', () => {
  // a slash command is handled locally; anything else reaches a model, and CI has none
  for (const flag of MODEL_INDEPENDENT) {
    const entry = TABLE.find((item) => item.flag === flag);
    assert.ok(entry, `${flag} is safe but has no scenario in the table`);
    const body = scenarioBody(entry.fn);
    const assignments = [...body.matchAll(/els\.input\.value = (['"`])(.{0,14})/g)];
    for (const assignment of assignments) {
      const opener = assignment[1];
      const quoted = assignment[2];
      if (quoted[0] === opener) continue; // clearing the composer sends nothing
      assert.ok(quoted.startsWith('/'), `${entry.fn} sends a non-slash prompt (${JSON.stringify(quoted)}), so it needs a model and cannot be in the safe set`);
    }
  }
});

test('STRATAPILOT_SMOKE_SAFE turns on the safe set and nothing that needs a model', () => {
  const info = smokeInfoFromEnv({ STRATAPILOT_SMOKE: '1', STRATAPILOT_SMOKE_SAFE: '1' });
  assert.equal(info.smoke, true);
  assert.equal(info.smokeSafe, true);
  assert.equal(info.smokePersist, true, 'export needs a session file on disk or it can only skip');
  assert.equal(info.smokeMonitor, true, 'the monitor panel is where the layout regressions used to hide');
  for (const flag of MODEL_INDEPENDENT) assert.equal(info[flag], true, `${flag} should be on`);
  for (const flag of allScenarioFlags()) {
    if (MODEL_INDEPENDENT.includes(flag) || flag === 'smokeMonitor') continue;
    assert.equal(info[flag], false, `${flag} needs a model and must stay off in CI`);
  }
});

test('naming a scenario explicitly still works, and does not drag the safe set in', () => {
  const info = smokeInfoFromEnv({ STRATAPILOT_SMOKE: '1', STRATAPILOT_SMOKE_BASH: '1' });
  assert.equal(info.smokeBash, true);
  assert.equal(info.smokeStorage, false);
  assert.equal(info.smokeSafe, false);
  assert.equal(info.smokePersist, false);
});

test('safeScenarioTags covers exactly the safe set, and the tags are distinct', () => {
  const tags = safeScenarioTags();
  assert.equal(tags.length, MODEL_INDEPENDENT.length);
  assert.equal(new Set(tags).size, tags.length, 'two scenarios sharing a tag would hide one another');
  for (const tag of tags) assert.ok(SMOKE_SRC.includes(`[${tag}]`), `${tag} is not printed anywhere`);
});

test('the CI job that runs the safe set is wired to it, and to the checker', () => {
  const ci = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const start = ci.indexOf('smoke-scenarios:');
  assert.ok(start > 0, 'the smoke-scenarios job is missing from CI');
  const job = ci.slice(start);
  assert.ok(/os: \[windows-latest, ubuntu-latest\]/.test(job), 'the scenarios must run on the two platforms this app ships on');
  assert.ok(job.includes('STRATAPILOT_SMOKE_SAFE'), 'the job must run the safe set, not a hand-picked list of flags that drifts');
  assert.ok(job.includes('scripts/check-smoke-log.js') && job.includes('--safe'), 'the verdict must come from the log checker');
  assert.ok(job.includes("require('./lib/pi-launch').TESTED_PI_VERSION"), 'pi must be pinned to the version this GUI is tested against, not to a literal that drifts');
  const lines = job.split('\n').map((line) => line.trim());
  assert.ok(!lines.some((line) => line.startsWith('curl -fsSL https://pi.dev/install.sh')), 'the managed installer refuses Windows and tracks its own channel, so a run would mean something different on every platform');
  assert.ok(!lines.some((line) => line.startsWith('curl -fsSL https://pi.dev/install.sh')), 'the managed installer refuses Windows and tracks its own channel, so a run would mean something different on every platform');
  assert.ok(job.includes('upload-artifact'), 'a failing run has to leave its log behind');
});

test('flag values: 0 and empty mean off, anything else means on', () => {
  assert.equal(isOn('0'), false);
  assert.equal(isOn(''), false);
  assert.equal(isOn(undefined), false);
  assert.equal(isOn('1'), true);
  assert.equal(isOn('yes'), true);
});

test('the env table has no duplicate keys and no unknown shape', () => {
  const keys = BOOLEAN_ENV.map(([, key]) => key);
  assert.equal(new Set(keys).size, keys.length, 'two env names write the same info key');
  for (const entry of STRING_ENV) {
    assert.equal(entry.length, 3, `${entry[0]} needs a fallback value`);
    assert.equal(typeof entry[2], 'string');
  }
});

test('the info object carries the string flags with their defaults', () => {
  const info = smokeInfoFromEnv({ STRATAPILOT_SMOKE: '1' }, { exportOutDefault: 'C:/tmp/out.html' });
  assert.equal(info.smokePrompt, '');
  assert.equal(info.smokeSession, '');
  assert.equal(info.smokeExportOut, 'C:/tmp/out.html');
  const set = smokeInfoFromEnv({ STRATAPILOT_SMOKE_PROMPT: 'hi', STRATAPILOT_SMOKE_EXPORT_OUT: '/x/y.html' });
  assert.equal(set.smokePrompt, 'hi');
  assert.equal(set.smokeExportOut, '/x/y.html');
});
