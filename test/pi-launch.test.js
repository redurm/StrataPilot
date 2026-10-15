'use strict';

/*
 * Unit tests for the pi version guard (C6).
 *
 * lib/pi-launch.js resolves pi through ~/.pi/agent/install/current-version, so an automatic pi
 * upgrade silently changes what the GUI talks to. piVersionStatus() is the pure part of that
 * check (the env bar and the diagnostics report both read it), and it needs no pi install.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { TESTED_PI_VERSION, piVersionStatus } = require('../lib/pi-launch');

test('TESTED_PI_VERSION is a concrete version, not a range', () => {
  assert.match(TESTED_PI_VERSION, /^\d+\.\d+\.\d+$/);
});

test('same major.minor counts as ok (patch releases do not change the RPC contract)', () => {
  assert.equal(piVersionStatus('1.2.0').level, 'ok');
  assert.equal(piVersionStatus('1.2.9').level, 'ok');
  assert.equal(piVersionStatus('1.2.0-beta.1').level, 'ok');
});

test('same major, different minor warns: pi adds RPC commands in minor releases', () => {
  const up = piVersionStatus('1.3.0');
  const down = piVersionStatus('1.1.4');
  assert.equal(up.level, 'warn');
  assert.equal(down.level, 'warn');
  assert.equal(up.installed, '1.3.0');
  assert.equal(up.tested, TESTED_PI_VERSION);
});

test('different major (or an unparseable version) is the red level', () => {
  assert.equal(piVersionStatus('2.0.0').level, 'differ');
  assert.equal(piVersionStatus('0.9.9').level, 'differ');
  assert.equal(piVersionStatus('').level, 'differ'); // pi not resolved at all
  assert.equal(piVersionStatus(null).level, 'differ');
  assert.equal(piVersionStatus('current-version').level, 'differ');
});

test('the comparison is not tied to one tested version', () => {
  assert.equal(piVersionStatus('3.4.1', '3.4.0').level, 'ok');
  assert.equal(piVersionStatus('3.5.0', '3.4.0').level, 'warn');
  assert.equal(piVersionStatus('4.0.0', '3.4.0').level, 'differ');
});
