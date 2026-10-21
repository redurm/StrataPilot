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

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

/* ---- #13: the cache used to be permanent, and any node on PATH was good enough ---- */

const {
  resolvePiInvocation,
  invalidatePiInvocationCache,
  versionOfCliPackage,
  PI_PACKAGE_NAME,
  INVOCATION_TTL_MS,
  MIN_NODE_VERSION,
  compareVersions,
} = require('../lib/pi-launch');

test('the resolved invocation is cached, and invalidating it forces a fresh look (#13)', () => {
  invalidatePiInvocationCache();
  const first = resolvePiInvocation();
  assert.equal(resolvePiInvocation(), first, 'a second call inside the TTL must be a cache hit (it spawns a probe process)');
  invalidatePiInvocationCache();
  assert.notEqual(resolvePiInvocation(), first, 'after invalidation the launcher must look again');
  assert.ok(Number.isFinite(INVOCATION_TTL_MS) && INVOCATION_TTL_MS > 0 && INVOCATION_TTL_MS <= 15 * 60 * 1000, `TTL=${INVOCATION_TTL_MS}`);
  // the point of the TTL: pi rewrites current-version under us on an automatic upgrade, and a
  // permanent cache meant the app kept spawning the OLD cliPath until it was restarted
  const pi = resolvePiInvocation();
  assert.ok(pi.piVersion === null || /^\d+\.\d+/.test(pi.piVersion), `piVersion=${pi.piVersion}`);
});

test('the Node floor the launcher enforces is the one package.json declares (#13)', () => {
  const engines = require('../package.json').engines.node;
  const declared = /(\d+\.\d+)/.exec(engines);
  assert.ok(declared, `could not read a floor out of engines.node=${engines}`);
  assert.equal(MIN_NODE_VERSION, declared[1], 'the launcher must accept exactly what the app claims to need');
});

test('an old Node on PATH is reported instead of being handed to pi (#13)', () => {
  assert.ok(compareVersions('22.19.0', MIN_NODE_VERSION) >= 0);
  assert.ok(compareVersions('18.20.4', MIN_NODE_VERSION) < 0, 'Node 18 must read as too old');
  assert.ok(compareVersions('24.19.0', MIN_NODE_VERSION) > 0);
  assert.ok(compareVersions('22.19', '22.19.0') === 0, 'a missing patch part is not allowed to look older');
  const inv = resolvePiInvocation();
  assert.ok(inv.nodeTooOld === true || inv.nodeTooOld === false, 'nodeTooOld must always be a decision, not undefined');
  if (inv.nodeTooOld) assert.ok(inv.nodeVersion, 'a rejection has to name the version it saw');
});


/* ---- the version of a pi that is not a managed install (#47) ---- */

function makeFakePi(root, version) {
  const pkgDir = path.join(root, 'node_modules', '@earendil-works', 'pi-coding-agent');
  const binDir = path.join(pkgDir, 'dist', 'bundle');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: PI_PACKAGE_NAME, version, bin: { pi: 'dist/bundle/cli.js' } }));
  fs.writeFileSync(path.join(binDir, 'cli.js'), '// stub');
  return { pkgDir, cliPath: path.join(binDir, 'cli.js') };
}

test('versionOfCliPackage reads the version of the package the CLI lives in', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stratapilot-piversion-'));
  try {
    const { cliPath } = makeFakePi(root, '9.9.9');
    // a decoy above it: the walk must find pi's package.json, not the first one it meets
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'some-workspace', version: '0.0.1' }));
    assert.equal(versionOfCliPackage(cliPath), '9.9.9');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a CLI with no pi package above it reports no version instead of guessing', () => {
  assert.equal(versionOfCliPackage(path.join(os.tmpdir(), 'stratapilot-not-pi-here', 'cli.js')), null);
  assert.equal(versionOfCliPackage(null), null);
});

test('STRATAPILOT_PI_CLI decides the reported version, not the managed install (#47)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stratapilot-pioverride-'));
  const previous = process.env.STRATAPILOT_PI_CLI;
  try {
    const { cliPath } = makeFakePi(root, '9.9.9');
    process.env.STRATAPILOT_PI_CLI = cliPath;
    invalidatePiInvocationCache();
    const inv = resolvePiInvocation();
    assert.equal(inv.cliPath, path.resolve(cliPath));
    assert.equal(inv.piVersion, '9.9.9', 'the env bar must describe the pi that will actually run, not the one the managed install happens to hold');
  } finally {
    if (previous === undefined) delete process.env.STRATAPILOT_PI_CLI;
    else process.env.STRATAPILOT_PI_CLI = previous;
    invalidatePiInvocationCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
