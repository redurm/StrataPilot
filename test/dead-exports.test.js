'use strict';

/*
 * #28: fifteen names were exported by lib modules that no file imported. An export is a surface: the
 * next reader has to work out who uses it, and the answer was "nobody" - while the caps that SHOULD
 * have been exercised by a test were not referenced by one.
 *
 * So the check is mechanical: every name in a `module.exports` object must be referenced from at least
 * one other file. Names that are legitimately reached indirectly (a value the app hands to Electron,
 * a constant the tests read through the module's own behaviour) go in the allowlist below, with a
 * reason - the allowlist is the reviewable part.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'coverage', '.cache']);

function sourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      sourceFiles(path.join(dir, entry.name), acc);
    } else if (entry.name.endsWith('.js')) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

/** name -> the file that exports it, for every `module.exports = { ... }` in the repo. */
function exportedNames(files, contents) {
  const found = [];
  for (const file of files) {
    const source = contents.get(file);
    for (const match of source.matchAll(/module\.exports\s*=\s*\{([\s\S]*?)\};/g)) {
      for (const name of match[1].matchAll(/([A-Za-z_$][\w$]*)\s*(?:,|:|\}|$)/g)) {
        const bare = name[1];
        if (bare === 'module' || bare === 'exports') continue;
        found.push({ name: bare, file });
      }
    }
    for (const match of source.matchAll(/module\.exports\.([A-Za-z_$][\w$]*)\s*=/g)) {
      found.push({ name: match[1], file });
    }
  }
  return found;
}

// reached without an import by name: Electron's own entry points and the smoke harness
const ALLOWLIST = new Set([]);

test('every exported name is imported somewhere (or the allowlist says why)', () => {
  const files = sourceFiles(ROOT);
  const contents = new Map(files.map((file) => [file, fs.readFileSync(file, 'utf8')]));
  const exports = exportedNames(files, contents);
  assert.ok(exports.length > 40, `only ${exports.length} exports found - the scanner is probably broken`);
  const unused = [];
  for (const item of exports) {
    if (ALLOWLIST.has(item.name)) continue;
    const pattern = new RegExp(`\\b${item.name.replace(/\$/g, '\\$')}\\b`);
    const usedElsewhere = files.some((file) => {
      if (file === item.file) return false;
      const source = contents.get(file);
      if (pattern.test(source)) return true;
      return false;
    });
    if (!usedElsewhere) unused.push(`${path.relative(ROOT, item.file)}: ${item.name}`);
  }
  assert.deepEqual(unused, [], 'exports nothing imports - use them in a test, call them, or drop them (#28)');
});
