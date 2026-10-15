'use strict';

/*
 * Unit tests for lib/pi-process.js: the JSONL framing helper (splitRecords)
 * and the RPC command pairing, exercised against a stub node script instead
 * of the real pi (no pi, no Strata, no network, no Electron).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');

const { PiRpcProcess, splitRecords } = require('../lib/pi-process');

const STUB = path.join(__dirname, 'fixtures', 'rpc-stub.js');

function startStub() {
  const proc = new PiRpcProcess({
    id: 'stub',
    cwd: __dirname,
    // injectable invocation: run the stub with the current node instead of pi
    invocation: { nodePath: process.execPath, cliPath: STUB, nodeArgPrefix: [], runAsNode: false },
  });
  proc.start();
  return proc;
}

/* ---- splitRecords: pure byte-level framing ---- */

test('splitRecords splits on LF only', () => {
  const { records, rest } = splitRecords(Buffer.alloc(0), Buffer.from('{"a":1}\n{"b":2}\n', 'utf8'));
  assert.deepEqual(records, ['{"a":1}', '{"b":2}']);
  assert.equal(rest.length, 0);
});

test('U+2028 / U+2029 inside a JSON string do NOT split a record', () => {
  const text = 'line1\u2028line2\u2029line3';
  const payload = JSON.stringify({ s: text });
  const { records, rest } = splitRecords(Buffer.alloc(0), Buffer.from(payload + '\n', 'utf8'));
  assert.equal(records.length, 1, `expected 1 record, got ${records.length}`);
  assert.equal(rest.length, 0);
  assert.equal(JSON.parse(records[0]).s, text);
});

test('a record split across two stdout chunks is rejoined', () => {
  const first = splitRecords(Buffer.alloc(0), Buffer.from('{"a":', 'utf8'));
  assert.deepEqual(first.records, []);
  assert.equal(first.rest.toString('utf8'), '{"a":');

  const second = splitRecords(first.rest, Buffer.from('1}\n{"b"', 'utf8'));
  assert.deepEqual(second.records, ['{"a":1}']);
  assert.equal(second.rest.toString('utf8'), '{"b"');

  const third = splitRecords(second.rest, Buffer.from(':2}\n', 'utf8'));
  assert.deepEqual(third.records, ['{"b":2}']);
  assert.equal(third.rest.length, 0);
});

test('CRLF line endings: the trailing CR is stripped', () => {
  const { records, rest } = splitRecords(Buffer.alloc(0), Buffer.from('{"a":1}\r\n{"b":2}\r\n', 'utf8'));
  assert.deepEqual(records, ['{"a":1}', '{"b":2}']);
  assert.equal(rest.length, 0);
  // a CR held at the chunk boundary is released once the LF arrives
  const half = splitRecords(Buffer.alloc(0), Buffer.from('{"c":3}\r', 'utf8'));
  assert.deepEqual(half.records, []);
  const done = splitRecords(half.rest, Buffer.from('\n', 'utf8'));
  assert.deepEqual(done.records, ['{"c":3}']);
});

test('blank and whitespace-only lines are dropped', () => {
  const { records } = splitRecords(Buffer.alloc(0), Buffer.from('\n\n{"a":1}\n   \n\t\n{"b":2}\n', 'utf8'));
  assert.deepEqual(records, ['{"a":1}', '{"b":2}']);
});

test('a multi-byte UTF-8 character split across chunk boundaries stays intact', () => {
  // framing is byte-level on a Buffer: cutting in the middle of the 3-byte
  // sequence for 日 must not corrupt or split the record
  const full = Buffer.from('{"t":"日本語"}\n', 'utf8');
  const first = splitRecords(Buffer.alloc(0), full.subarray(0, 8)); // 日 spans bytes 6..8
  assert.deepEqual(first.records, []);
  assert.equal(first.rest.length, 8);
  const second = splitRecords(first.rest, full.subarray(8));
  assert.equal(second.records.length, 1);
  assert.equal(JSON.parse(second.records[0]).t, '日本語');
});

/* ---- PiRpcProcess against the stub RPC peer ---- */

test('command() pairs concurrent responses by id; garbage emits log, events emit record', async () => {
  const proc = startStub();
  const logs = [];
  const records = [];
  proc.on('log', (m) => logs.push(m));
  proc.on('record', (r) => records.push(r));

  const [a, b] = await Promise.all([
    proc.command('echo', { payload: 'A' }),
    proc.command('echo', { payload: 'B' }),
  ]);
  assert.equal(a.success, true);
  assert.deepEqual(a.data, { echo: 'A' });
  assert.equal(b.success, true);
  assert.deepEqual(b.data, { echo: 'B' });

  // the stub emits a garbage line on startup -> `log`, and a non-response
  // record -> `record`
  assert.ok(logs.some((m) => m.includes('unparsable record')), `logs: ${logs.join(' | ')}`);
  assert.ok(records.some((r) => r.type === 'extension_message'), `records: ${JSON.stringify(records)}`);

  const exited = once(proc, 'exit');
  proc.dispose();
  await exited;
});

test('a response split across two stdout chunks is rejoined before parsing', async () => {
  const proc = startStub();
  const res = await proc.command('echo', { payload: 'A', split: true });
  assert.equal(res.success, true);
  assert.deepEqual(res.data, { echo: 'A' });
  const exited = once(proc, 'exit');
  proc.dispose();
  await exited;
});

test('command() honours a caller-provided id', async () => {
  const proc = startStub();
  const res = await proc.command('echo', { id: 'custom-42', payload: 'C' });
  assert.equal(res.success, true);
  assert.deepEqual(res.data, { echo: 'C' });
  const exited = once(proc, 'exit');
  proc.dispose();
  await exited;
});

test('command() times out when no matching response arrives', async () => {
  const proc = startStub();
  const res = await proc.command('silent', {}, 300);
  assert.equal(res.success, false);
  assert.equal(res.timeout, true);
  assert.match(res.error, /timeout after 300ms/);
  const exited = once(proc, 'exit');
  proc.dispose();
  await exited;
});

test('pending commands settle with "pi process exited" when the child dies', async () => {
  const proc = startStub();
  const exited = once(proc, 'exit');
  const res = await proc.command('boom');
  // pending entries store { resolve, reject: resolve }: the exit settles the
  // promise with an Error value (callers check .success / .message)
  assert.ok(res instanceof Error, `expected an Error value, got ${JSON.stringify(res)}`);
  assert.match(res.message, /pi process exited/);
  const [info] = await exited;
  assert.equal(info.code, 3);
});

test('command() on a process that was never started resolves as not running', async () => {
  const proc = new PiRpcProcess({
    id: 'dead',
    cwd: __dirname,
    invocation: { nodePath: process.execPath, cliPath: STUB, nodeArgPrefix: [], runAsNode: false },
  });
  const res = await proc.command('get_state');
  assert.equal(res.success, false);
  assert.match(res.error, /pi process is not running/);
});
