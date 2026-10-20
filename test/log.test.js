'use strict';

/*
 * Unit tests for lib/log.js: the file log that makes a crash diagnosable after
 * the fact. Runs entirely in a temp folder — no Electron, no pi, no network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appLog = require('../lib/log');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stratapilot-log-'));
}

function readLog(file) {
  return fs.readFileSync(file, 'utf8');
}

test('write() before init() is a silent no-op (logging must never crash the app)', () => {
  assert.doesNotThrow(() => appLog.write('error', 'dropped'));
  assert.equal(appLog.logPath(), '');
  assert.equal(appLog.logDir(), '');
});

test('init() creates the parent folders and reports the paths', () => {
  const dir = tempDir();
  const file = path.join(dir, 'logs', 'stratapilot.log');
  appLog.init(file);
  assert.equal(appLog.logPath(), file);
  assert.equal(appLog.logDir(), path.join(dir, 'logs'));
  assert.ok(fs.existsSync(file));
});

test('write() emits one `[ISO] [LEVEL] text` record per call', () => {
  const dir = tempDir();
  const file = path.join(dir, 'logs', 'stratapilot.log');
  appLog.init(file);
  appLog.write('info', 'hello');
  appLog.write('error', 'boom');
  const lines = readLog(file).split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[INFO\] hello$/);
  assert.match(lines[1], /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[ERROR\] boom$/);
});

test('a single record is capped, so one huge blob cannot bloat the file', () => {
  const dir = tempDir();
  const file = path.join(dir, 'logs', 'stratapilot.log');
  appLog.init(file);
  appLog.write('error', 'x'.repeat(appLog.MAX_LINE + 5000));
  const line = readLog(file).split('\n')[0];
  // prefix is `[<ISO>] [LEVEL] ` (35 chars for ERROR); the payload is capped
  assert.ok(line.length <= appLog.MAX_LINE + 40, `line length ${line.length}`);
});

test('banner() records the versions/paths a bug report needs', () => {
  const dir = tempDir();
  const file = path.join(dir, 'logs', 'stratapilot.log');
  appLog.init(file);
  appLog.banner({ appVersion: '0.1.0', electronVersion: '40.10.2', logFile: file });
  const text = readLog(file);
  assert.match(text, /appVersion=0\.1\.0/);
  assert.match(text, /electronVersion=40\.10\.2/);
  assert.match(text, /logFile=/);
});

test('teeConsole() mirrors console.* to the file and restore() puts console back', () => {
  const dir = tempDir();
  const file = path.join(dir, 'logs', 'stratapilot.log');
  appLog.init(file);
  const original = console.log;
  const restore = appLog.teeConsole();
  assert.notEqual(original, console.log, 'console.log should be patched');
  console.log('[spawn] tab=1 ok');
  console.error('[crash] renderer gone reason=crashed exitCode=1');
  restore();
  assert.equal(console.log, original);
  const text = readLog(file);
  assert.match(text, /\[LOG\] \[spawn\] tab=1 ok/);
  assert.match(text, /\[ERROR\] \[crash\] renderer gone reason=crashed exitCode=1/);
});

test('teeConsole() keeps util.format semantics (%s / objects)', () => {
  const dir = tempDir();
  const file = path.join(dir, 'logs', 'stratapilot.log');
  appLog.init(file);
  const restore = appLog.teeConsole();
  console.log('tab=%s meta=%j', 't1', { a: 1 });
  restore();
  assert.match(readLog(file), /tab=t1 meta=\{"a":1\}/);
});

test('rotation keeps the active file bounded and honours keep', () => {
  const dir = tempDir();
  const file = path.join(dir, 'logs', 'stratapilot.log');
  const maxBytes = 2000;
  appLog.init(file, { maxBytes, keep: 2 });
  for (let i = 0; i < 200; i++) appLog.write('info', `line ${i} ${'y'.repeat(40)}`);

  assert.ok(fs.existsSync(`${file}.1`), 'expected a rotated .1 file');
  assert.ok(fs.existsSync(`${file}.2`), 'expected .2 as the oldest kept generation');
  assert.ok(!fs.existsSync(`${file}.3`), 'keep=2 must not accumulate a .3');
  assert.ok(fs.statSync(file).size <= maxBytes + 200, 'active file should stay near maxBytes');

  // the newest record is always in the active file
  assert.match(readLog(file), /line 199/);

  // generations stay in chronological order: .2 older than .1 older than active
  const firstNum = (f) => Number(readLog(f).match(/line (\d+)/)[1]);
  const n2 = firstNum(`${file}.2`);
  const n1 = firstNum(`${file}.1`);
  const n0 = firstNum(file);
  assert.ok(n2 < n1 && n1 < n0, `generation order broken: .2=${n2} .1=${n1} active=${n0}`);

  // retention is bounded: with keep=2 the oldest lines are dropped, not hoarded
  const all = readLog(file) + readLog(`${file}.1`) + readLog(`${file}.2`);
  assert.ok(!/^.*line 0 /m.test(all), 'line 0 should have been rotated away');
});

test('init() on an unwritable path disables logging instead of throwing', () => {
  // a path whose parent is a *file* cannot be created -> init must swallow it
  const dir = tempDir();
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'not a folder');
  assert.doesNotThrow(() => appLog.init(path.join(blocker, 'logs', 'stratapilot.log')));
  assert.doesNotThrow(() => appLog.write('error', 'still running'));
});

test('rotation does not stat the file on every line (#13)', () => {
  const dir = tempDir();
  const file = path.join(dir, 'stratapilot.log');
  appLog.init(file);
  const real = fs.statSync;
  let stats = 0;
  fs.statSync = function patched(...args) {
    if (String(args[0] || '').includes('stratapilot.log')) stats += 1;
    return real.apply(fs, args);
  };
  try {
    for (let i = 0; i < 200; i += 1) appLog.write('info', `line-${i}`);
  } finally {
    fs.statSync = real;
  }
  assert.ok(stats <= 20, `${stats} stats for 200 lines: the in-memory counter has to carry the common case`);
  const text = readLog(file);
  assert.equal(text.split('\n').filter((line) => line.includes('line-')).length, 200, 'every line still landed');
  fs.appendFileSync(file, 'x'.repeat(5 * 1024 * 1024));
  appLog.init(file); // a restart always re-measures the file, even inside the resync window
  appLog.write('info', 'after the restart');
  appLog.write('info', 'past the cap');
  assert.ok(fs.existsSync(`${file}.1`), 'the cap still triggers a real rotation');
});
