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

test('the packaging config can actually produce artifacts (#38)', () => {
  // electron-builder needs a maintainer email for the .deb control file; a bare string author is legal
  // JSON and fails only on Linux, which is how this shipped broken
  const author = pkg.author;
  assert.equal(typeof author, 'object', 'package.json author must be { name, email }, not a bare string');
  assert.ok(author && author.email && /@/.test(author.email), 'package.json author has no email: the .deb build fails');
  assert.ok(author && author.name, 'package.json author has no name');
  // a tag push makes electron-builder v26 publish to GitHub Releases by default; without GH_TOKEN that
  // error lands after every artifact is built, so the job fails and nothing gets uploaded
  assert.strictEqual(pkg.build.publish, null, 'build.publish must be null: the workflow uploads artifacts itself');
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  const calls = yml.match(/npx electron-builder.*/g) || [];
  assert.ok(calls.length >= 3, `expected three electron-builder invocations, found ${calls.length}`);
  for (const call of calls) {
    assert.ok(/--publish\s+never/.test(call), `release.yml is missing --publish never: ${call.trim()}`);
  }
});

test('every released version has its own entries, and the rule text stays where it belongs (#41)', () => {
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const headings = [...changelog.matchAll(/^## \[([^\]]+)\]( .*)?$/gm)];
  assert.ok(headings.length >= 3, 'expected at least Unreleased and two versions');
  for (let i = 0; i < headings.length; i += 1) {
    const name = headings[i][1];
    const from = headings[i].index + headings[i][0].length;
    const to = i + 1 < headings.length ? headings[i + 1].index : changelog.length;
    const body = changelog.slice(from, to).trim();
    if (name === 'Unreleased') continue;
    // the release-notes script refuses a section like this, so catch it here instead of at release time
    assert.match(body, /^### /m, `${name} has no entry heading: its release notes would be empty`);
    assert.match(body, /^- /m, `${name} has no entries`);
    assert.ok(!body.includes('Nothing unreleased'), `${name} carries the Unreleased rule text`);
    assert.ok(!body.includes('The rule this file follows'), `${name} carries the Unreleased rule text`);
  }
  const rule = changelog.match(/The rule this file follows/g) || [];
  assert.equal(rule.length, 1, `the versioning rule is repeated ${rule.length} times across the file`);
  // it has to sit in the header: a rule paragraph inside `## [Unreleased]` gets carried into the next
  // version when the block is folded, which is how 0.2.1 shipped with no entries of its own (#41)
  const firstHeading = changelog.indexOf('## [');
  assert.ok(changelog.indexOf('The rule this file follows') < firstHeading, 'the rule text must live in the header, above the first section');
});

test('a tag actually publishes a GitHub Release (#41)', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(yml, /publish-release:/);
  assert.ok(yml.includes('gh release create') && /--verify-tag/.test(yml), 'the release job must create the tag release with --verify-tag');
  assert.match(yml, /gh release upload --clobber/); // a re-run on the same tag must not fail
  assert.match(yml, /secrets\.GITHUB_TOKEN/);
  assert.match(yml, /scripts\/release-notes\.js/);
});
