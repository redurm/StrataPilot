'use strict';

/*
 * Unit tests for lib/net-policy.js and lib/fs-guard.js (#6).
 *
 * Both modules exist because three IPC endpoints attached the environment API key to any URL the
 * renderer supplied (only the protocol was checked, and `http:` passed), and because `fs:read-text`
 * read any absolute path on disk. The decisions are pure functions so they can be pinned here,
 * without Electron and without a Strata server.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const net = require('../lib/net-policy');
const guard = require('../lib/fs-guard');

const KEY = 'sk-test-key-never-real';

/* ---- net-policy: local / LAN hosts ---- */

test('isLocalHost(): loopback, RFC1918 and the local names a Strata box uses', () => {
  for (const host of ['localhost', '127.0.0.1', '127.8.9.10', '::1', '[::1]', '0.0.0.0', 'strata.local', 'box.lan', 'server.home', 'lab.internal', '10.1.2.3', '192.168.4.20', '172.16.0.9', '172.31.255.255']) {
    assert.equal(net.isLocalHost(host), true, `${host} should count as local`);
  }
  for (const host of ['strata.example.com', '8.8.8.8', '172.15.0.1', '172.32.0.1', '11.0.0.1', '169.254.1.1', '', 'localhost.evil.com']) {
    assert.equal(net.isLocalHost(host), false, `${host} must not count as local`);
  }
});

/* ---- net-policy: protocol ---- */

test('urlPolicy(): https anywhere, http only to a local or LAN address (#6)', () => {
  assert.equal(net.urlPolicy(new URL('https://strata.example.com/health')).ok, true);
  assert.equal(net.urlPolicy(new URL('http://127.0.0.1:8081/health')).ok, true);
  assert.equal(net.urlPolicy(new URL('http://192.168.1.30:8081/health')).ok, true);
  const refused = net.urlPolicy(new URL('http://strata.example.com/health'));
  assert.equal(refused.ok, false, 'plain http to a remote host must be refused: the key travels in clear text');
  assert.match(refused.error, /clear text/);
  assert.equal(net.urlPolicy(new URL('file:///etc/passwd')).ok, false);
  assert.equal(net.urlPolicy(new URL('ws://127.0.0.1:8081/')).ok, false);
  assert.equal(net.urlPolicy(null).ok, false);
});

/* ---- net-policy: who gets the key ---- */

test('keyForHost(): the key goes to a local address or a configured server, to nothing else (#6)', () => {
  const allowlist = ['https://strata.example.com/v1', 'http://10.0.0.7:8081/v1'];

  // local: the normal case, a Strata server on this machine
  let decision = net.keyForHost(new URL('http://127.0.0.1:8081/metrics'), allowlist, KEY);
  assert.equal(decision.key, KEY);
  assert.equal(decision.withheld, false);

  // configured: a remote server the user added on purpose (origin match, /v1 spelling tolerated)
  decision = net.keyForHost(new URL('https://strata.example.com/metrics'), allowlist, KEY);
  assert.equal(decision.key, KEY, 'a configured server keeps its key');
  assert.equal(decision.withheld, false);

  // anything else: no key, and a reason that can be logged
  decision = net.keyForHost(new URL('https://collector.example.net/metrics'), allowlist, KEY);
  assert.equal(decision.key, '', 'a host nobody configured must never see the key');
  assert.equal(decision.withheld, true);
  assert.match(decision.reason, /collector\.example\.net/);

  // a different origin that merely starts the same way is not the same server
  decision = net.keyForHost(new URL('https://strata.example.com.evil.io/metrics'), allowlist, KEY);
  assert.equal(decision.withheld, true, 'origin match, not prefix match');

  // no key configured is not "withheld" - there is nothing to withhold
  decision = net.keyForHost(new URL('https://collector.example.net/metrics'), allowlist, '');
  assert.equal(decision.key, '');
  assert.equal(decision.withheld, false);
});

test('allowlistFrom(): strataUrl plus strataUrls, blanks dropped', () => {
  assert.deepEqual(net.allowlistFrom({ strataUrl: 'http://127.0.0.1:8081/v1', strataUrls: ['', 'https://a.example'] }), [
    'http://127.0.0.1:8081/v1',
    'https://a.example',
  ]);
  assert.deepEqual(net.allowlistFrom({}), []);
  assert.deepEqual(net.allowlistFrom(null), []);
});

test('normalizeBaseUrl(): trailing slashes and the /v1 suffix the app accepts', () => {
  assert.equal(net.normalizeBaseUrl('http://127.0.0.1:8081/v1/'), 'http://127.0.0.1:8081');
  assert.equal(net.normalizeBaseUrl('  https://a.example/v1 '), 'https://a.example');
  assert.equal(net.parseBaseUrl('not a url'), null);
});

/* ---- fs-guard: reading ---- */

const SESSIONS = path.resolve(path.sep + path.join('sessions-root'));
const USER_DATA = path.resolve(path.sep + path.join('app-data'));
const CHOSEN = path.resolve(path.sep + path.join('home', 'redur', 'work'));

test('readAllowed(): only inside a root the app owns or a folder picked in a dialog (#6)', () => {
  const roots = [SESSIONS, USER_DATA, CHOSEN];
  assert.equal(guard.readAllowed(path.join(SESSIONS, 'g1', 'a.jsonl'), { roots }).ok, true);
  assert.equal(guard.readAllowed(path.join(USER_DATA, 'token_usage.json'), { roots }).ok, true);
  assert.equal(guard.readAllowed(path.join(CHOSEN, 'notes.txt'), { roots }).ok, true);

  // the exact chain the report describes: the pi config that holds the Strata key
  const piConfig = path.resolve(path.sep + path.join('home', 'redur', '.pi', 'agent', 'models.json'));
  const refused = guard.readAllowed(piConfig, { roots });
  assert.equal(refused.ok, false, 'models.json must not be readable through fs:read-text');
  assert.match(refused.error, /outside the sessions folder/);
  assert.equal(guard.readAllowed(path.resolve(path.sep + 'Windows', 'system32', 'config', 'sam'), { roots }).ok, false);
  // `..` must not walk out of an allowed root
  assert.equal(guard.readAllowed(path.join(CHOSEN, '..', '..', 'etc', 'passwd'), { roots }).ok, false);
  assert.equal(guard.readAllowed('', { roots }).ok, false);
  assert.equal(guard.readAllowed('anything', { roots: [] }).ok, false);
});

/* ---- fs-guard: statting ---- */

test('statAllowed(): open for drag & drop, but the credential-bearing paths are denied (#6)', () => {
  const denied = [path.resolve(path.sep + path.join('home', 'redur', '.pi', 'agent')), path.resolve(path.sep + path.join('app-data', 'stratapilot_settings.json'))];
  const ok = guard.statAllowed(path.resolve(path.sep + path.join('home', 'redur', 'Downloads', 'photo.png')), { denied });
  assert.equal(ok.ok, true, 'a dropped file from anywhere is still statable');
  for (const target of [
    path.resolve(path.sep + path.join('home', 'redur', '.pi', 'agent', 'models.json')),
    path.resolve(path.sep + path.join('home', 'redur', '.pi', 'agent')),
    path.resolve(path.sep + path.join('app-data', 'stratapilot_settings.json')),
  ]) {
    const refused = guard.statAllowed(target, { denied });
    assert.equal(refused.ok, false, `${target} must be off limits`);
    assert.match(refused.error, /off limits/);
  }
});

test('isInside(): a root is not inside itself, and a sibling with the same prefix is not inside', () => {
  assert.equal(guard.isInside(SESSIONS, path.join(SESSIONS, 'a.jsonl')), true);
  assert.equal(guard.isInside(SESSIONS, SESSIONS), false);
  assert.equal(guard.isInside(SESSIONS, `${SESSIONS}-backup`), false);
  assert.equal(guard.isInside('', SESSIONS), false);
});
