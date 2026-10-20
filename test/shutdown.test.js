'use strict';

/*
 * Unit tests for lib/shutdown.js (#8).
 *
 * The two quit paths in main.js need Electron, but both bugs were in the part that does not: how
 * long the children get, and WHEN the usage ledger is flushed. A fake child (an EventEmitter with a
 * dispose() that records the grace it was given) pins both.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { disposeAll, QUIT_GRACE_MS } = require('../lib/shutdown');

class FakeProc extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.grace = null;
  }
  dispose({ graceMs } = {}) {
    this.grace = graceMs;
  }
}

test('the quit grace is 5 s, not the 300 ms that could truncate a session file (#8)', () => {
  assert.equal(QUIT_GRACE_MS, 5000, '300 ms is shorter than a model round trip and shorter than a flush on a slow disk');
  const procs = new Map([['a', new FakeProc('a')]]);
  const logs = [];
  const result = disposeAll(procs, { onLog: (text) => logs.push(text) });
  assert.equal(procs.get('a').grace, QUIT_GRACE_MS, 'the grace has to reach dispose()');
  assert.ok(logs.some((text) => /grace=5000ms/.test(text)), `the grace has to be visible in the log: ${JSON.stringify(logs)}`);
  assert.equal(result.tabs, 1);
});

test('the ledger is flushed only after every child has stopped writing (#8)', () => {
  const a = new FakeProc('a');
  const b = new FakeProc('b');
  const procs = new Map([['a', a], ['b', b]]);
  const order = [];
  const result = disposeAll(procs, { onAllGone: () => order.push('flush') });
  order.push('disposed');
  b.emit('exit', {});
  assert.deepEqual(order, ['disposed'], 'one child is still alive: the rollup must not be written yet');
  a.emit('exit', {});
  assert.deepEqual(order, ['disposed', 'flush'], 'the last child exiting is what flushes');
  a.emit('exit', {});
  assert.equal(order.length, 2, 'a duplicate exit event must not flush twice');
  assert.equal(result.finished(), false, 'the failsafe must not flush a second time either');
});

test('no children at all still flushes the ledger (#8)', () => {
  let flushed = 0;
  const result = disposeAll(new Map(), { onAllGone: () => flushed++ });
  assert.equal(flushed, 1);
  assert.equal(typeof result.finished, 'function', 'the caller arms a failsafe unconditionally');
  assert.equal(result.finished(), false);
});

test('a child that never emits exit cannot starve the flush: the failsafe does it, once (#8)', () => {
  const procs = new Map([['a', new FakeProc('a')]]);
  let flushed = 0;
  const result = disposeAll(procs, { onAllGone: () => flushed++ });
  assert.equal(flushed, 0, 'nothing has exited yet');
  assert.equal(result.finished(), true, 'the failsafe flushes');
  assert.equal(result.finished(), false, 'and only once');
  assert.equal(flushed, 1);
});
