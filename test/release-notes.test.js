// #41: the GitHub Release notes come from CHANGELOG.md, so the section for the version being tagged has
// to exist and has to stop at the next heading. These tests cover the extractor and the promise that
// package.json's version always has a section to publish.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { section } = require('../scripts/release-notes.js');

const ROOT = path.join(__dirname, '..');
const CHANGELOG = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NL = String.fromCharCode(10);

test('a version section is returned whole and stops at the next heading', () => {
  const notes = section(CHANGELOG, '0.2.1');
  assert.ok(notes.length > 200, 'the 0.2.1 notes came back empty or tiny');
  assert.ok(!notes.includes('## [0.2.0]'), 'the notes ran past the next version heading');
  assert.ok(!notes.startsWith('## ['), 'the notes still carry their own heading');
});

test('a tag name (v0.2.1) works as well as a version (0.2.1)', () => {
  assert.equal(section(CHANGELOG, 'v0.2.1'), section(CHANGELOG, '0.2.1'));
});

test('an unknown version returns nothing instead of an empty release', () => {
  assert.equal(section(CHANGELOG, '9.9.9'), '');
  assert.equal(section(CHANGELOG, ''), '');
});

test('a version section that still carries the placeholder is refused, not published', () => {
  // what actually goes wrong at release time: folding moves the Unreleased block under a version
  // heading and the "Nothing unreleased." line comes with it, so the release would say that
  const synthetic = [
    '## [Unreleased]',
    '',
    '### Fixed',
    '',
    '- **something real** - details (#9).',
    '',
    '## [9.9.9] - 2026-01-01',
    '',
    'Nothing unreleased. The rule this file follows.',
    '',
  ].join(NL);
  assert.equal(section(synthetic, '9.9.9'), '');

  // the same file folded the right way does produce notes
  const folded = [
    '## [Unreleased]',
    '',
    'Nothing unreleased.',
    '',
    '## [9.9.9] - 2026-01-01',
    '',
    '### Fixed',
    '',
    '- **something real** - details (#9).',
  ].join(NL);
  assert.match(section(folded, '9.9.9'), /something real/);
});

test('the version in package.json always has release notes ready', () => {
  const notes = section(CHANGELOG, pkg.version);
  assert.ok(notes, `CHANGELOG.md has no section for ${pkg.version}: the release would go out with no notes`);
  assert.match(notes, /^### /m, `the ${pkg.version} notes have no entry headings`);
});

test('the CLI fails loudly for a version that has no section', () => {
  const script = path.join(ROOT, 'scripts', 'release-notes.js');
  assert.throws(
    () => execFileSync(process.execPath, [script, '9.9.9'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    /no section for 9\.9\.9/,
  );
  const out = execFileSync(process.execPath, [script, 'v0.2.1'], { encoding: 'utf8' });
  assert.ok(out.length > 200, 'the CLI printed almost nothing for a version that has a section');
  assert.ok(!out.startsWith('## ['), 'the CLI printed the heading too, which duplicates the release title');
});
