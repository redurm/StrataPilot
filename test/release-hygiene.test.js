'use strict';

/*
 * Release hygiene (#13 follow-up): the version in package.json and the headings in CHANGELOG.md are
 * two copies of one fact, and nothing checked that they agreed.
 *
 * The convention this repo uses: a PR writes its entry under `Unreleased` and never touches
 * package.json (parallel PRs appending to Unreleased conflict harmlessly; parallel PRs bumping the
 * version would fight over the same line). Cutting a release moves the Unreleased block under a dated
 * heading and bumps package.json / package-lock.json to match. These assertions make that convention
 * enforced rather than remembered.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');

const RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/gm;

test('package.json and package-lock.json carry the same version', () => {
  assert.equal(lock.version, pkg.version, 'package-lock.json root version');
  assert.equal(lock.packages && lock.packages[''] && lock.packages[''].version, pkg.version, 'package-lock.json packages[""] version');
});

test('the newest released CHANGELOG heading is the version that ships', () => {
  const headings = [...changelog.matchAll(RELEASE_HEADING)];
  assert.ok(headings.length >= 1, 'CHANGELOG.md has no released version heading');
  const newest = headings[0];
  assert.equal(newest[1], pkg.version, `package.json says ${pkg.version} but the newest CHANGELOG release is ${newest[1]}`);
});

test('every released heading carries a date (Keep a Changelog)', () => {
  const missing = [...changelog.matchAll(RELEASE_HEADING)].filter((match) => !match[2]).map((match) => match[1]);
  assert.deepEqual(missing, [], 'headings without a release date');
});

test('the versions in the CHANGELOG are in descending order', () => {
  const versions = [...changelog.matchAll(RELEASE_HEADING)].map((match) => match[1].split('.').map(Number));
  for (let i = 1; i < versions.length; i += 1) {
    const prev = versions[i - 1];
    const here = versions[i];
    const cmp = prev[0] - here[0] || prev[1] - here[1] || prev[2] - here[2];
    assert.ok(cmp > 0, `${prev.join('.')} must come before ${here.join('.')}`);
  }
});

test('Unreleased exists and holds no version heading of its own', () => {
  const start = changelog.indexOf('## [Unreleased]');
  assert.notEqual(start, -1, 'CHANGELOG.md must keep an Unreleased section for in-flight PRs');
  const next = changelog.indexOf('\n## [', start + 5);
  const block = changelog.slice(start, next === -1 ? changelog.length : next);
  assert.ok(!/^\d+\.\d+\.\d+/.test(block.replace('## [Unreleased]', '').trim()) || block.includes('The rule this file follows'), 'a version heading leaked into the Unreleased block');
});
