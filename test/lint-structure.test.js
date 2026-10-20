'use strict';

/*
 * The structural check that stands in for a linter (#13).
 *
 * The motivating bug (#5) was invisible to every test in this repo: `main.js` had
 *
 *     ipcMain.handle('app:smoke-shot', async () => {
 *     if (!win()) return { ok: false, error: 'no window' };   // <- column 0, still inside registerIpc()
 *
 * JavaScript ignores whitespace, so it parsed fine; `win()` was two scopes away and resolved as a
 * global, so the handler threw a ReferenceError the moment it ran - inside Electron only, which the
 * unit tests never start. The check exists so that shape fails CI instead of shipping.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { findSuspiciousDedents, lint, sourceFiles } = require('../scripts/lint-structure');

test('the #5 shape is caught: a block opened at an indent, its first statement at column 0', () => {
  const source = [
    "function registerIpc() {",
    "  ipcMain.handle('app:smoke-shot', async () => {",
    "if (!win()) return { ok: false };",
    "    return capture(win());",
    "  });",
    "}",
  ].join('\n');
  const findings = findSuspiciousDedents(source);
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].line, 3);
  assert.equal(findings[0].openedAt, 2);
  assert.match(findings[0].text, /^if \(!win\(\)\)/);
});

test('correctly indented code is left alone, including nested one-line blocks', () => {
  const source = [
    "function registerIpc() {",
    "  ipcMain.handle('app:smoke-shot', async () => {",
    "    if (!win()) return { ok: false };",
    "    return capture(win());",
    "  });",
    "  const rows = [",
    "    1,",
    "  ];",
    "  return rows;",
    "}",
  ].join('\n');
  assert.deepEqual(findSuspiciousDedents(source), []);
});

test('a template literal holding column-0 text (docs blocks) is not a statement', () => {
  const source = [
    "function build() {",
    "  const md = [",
    "    `",
    "# Heading at column zero",
    "",
    "const notCode = 1;",
    "`",
    "  ].join('');",
    "  return md;",
    "}",
  ].join('\n');
  assert.deepEqual(findSuspiciousDedents(source), []);
});

test('the whole repo passes: the check is wired into CI, so it must not cry wolf today', () => {
  const root = path.join(__dirname, '..');
  const files = sourceFiles(root);
  assert.ok(files.length >= 20, `${files.length} source files found - the walker is probably skipping too much`);
  assert.deepEqual(lint(root), [], 'dedented block start found');
});
