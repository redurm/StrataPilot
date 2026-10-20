#!/usr/bin/env node
/*
 * Pull one version's CHANGELOG section out and use it as the GitHub Release notes (#41).
 *
 * The rule this repo already follows is that CHANGELOG.md is the user-facing release notes and git log
 * is the developer-facing one. Until now nothing enforced that the release page actually came from the
 * CHANGELOG - the tag was cut, the installers were built, and the Release page simply did not exist.
 *
 *   node scripts/release-notes.js 0.2.1            -> prints the section
 *   node scripts/release-notes.js v0.2.1 > notes   -> a v-prefixed tag name works too
 *
 * Exits non-zero when the version has no section: opening a release with empty notes is how a version
 * ends up with no explanation of what changed.
 */
const fs = require('node:fs');
const path = require('node:path');

function section(changelog, version) {
  const clean = String(version || '').replace(/^v/, '');
  const heading = `## [${clean}]`;
  const start = changelog.indexOf(heading);
  if (start === -1) return '';
  // the heading line carries the date (`## [0.2.1] - 2026-10-20`), which is not part of the notes
  const lineEnd = changelog.indexOf('\n', start);
  if (lineEnd === -1) return '';
  const body = changelog.slice(lineEnd + 1);
  const next = body.search(/^## \[/m);
  const text = (next === -1 ? body : body.slice(0, next)).trim();
  // a section with only the heading is a placeholder, not notes
  return text.includes('Nothing unreleased') ? '' : text;
}

module.exports = { section };

if (require.main === module) {
  const version = process.argv[2] || '';
  const file = process.argv[3] || path.join(__dirname, '..', 'CHANGELOG.md');
  if (!version) {
    console.error('usage: node scripts/release-notes.js <version> [changelog]');
    process.exit(2);
  }
  let text;
  try {
    text = section(fs.readFileSync(file, 'utf8'), version);
  } catch (err) {
    console.error(`could not read ${file}: ${err.message}`);
    process.exit(2);
  }
  if (!text) {
    console.error(`${path.basename(file)} has no section for ${version}`);
    process.exit(1);
  }
  process.stdout.write(`${text}\n`);
}
