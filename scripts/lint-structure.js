'use strict';

/*
 * A structural check with no dependency, run in CI (`npm run lint`).
 *
 * This repo has no linter, and the bug that motivated this script is exactly the class of thing a
 * linter catches for free: in `main.js` the `app:smoke-shot` handler's body was indented to column 0
 * while still sitting inside the `registerIpc()` block, so `win()` - declared two levels up - was
 * resolved as a global, threw a ReferenceError, and the smoke screenshot never worked. Nothing in the
 * test suite could see it, because the code it broke only runs inside Electron (#5).
 *
 * Indentation drift is not a style problem in JavaScript: whitespace carries no meaning, so a dedented
 * block still parses, and the only visible symptom is a name resolving to the wrong scope (or to a
 * global) at runtime, in code the unit tests never load.
 */

const fs = require('node:fs');
const path = require('node:path');

const NEWLINE = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + NEWLINE;

const STATEMENT_START =
  /^(?:const|let|var|if|for|while|do|switch|try|catch|finally|return|throw|await|function|class|new|delete|typeof|void|console|[A-Za-z_$][A-Za-z0-9_$]*(?:\s*[=(.[]|\s*\+\+=|\s*-=))/;
/** A line that opens a block: the brace is the last thing on it. */
const OPENS_BLOCK = /\{\s*$/;

/**
 * The #5 signature, stated narrowly enough to run without a JavaScript parser.
 *
 * A block opened at an indent with its first statement at column 0 is what the `app:smoke-shot`
 * handler looked like: `ipcMain.handle(... => {` at indent 4, then `if (!win())` at column 0. That is
 * legal syntax, and it changes nothing about scope by itself - what it signals is that the block was
 * written by hand in the wrong place, which is how a name ends up resolving to a global. Correctly
 * indented code never produces this shape, so the check stays quiet on a clean tree and points
 * straight at the line where the damage starts.
 *
 * Narrow on purpose: a general "statement at column 0 inside a block" rule needs a real tokenizer.
 * Regex literals containing quotes, template literals holding markdown, and apostrophes inside
 * comments all break a hand-rolled one, and a linter that cries wolf gets ignored.
 */
function findSuspiciousDedents(source) {
  const lines = String(source).split(CRLF).join(NEWLINE).split(NEWLINE);
  const findings = [];
  let prevOpenLine = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const indent = line.length - line.trimStart().length;
    if (prevOpenLine !== null && indent === 0 && prevOpenLine.indent > 0 && STATEMENT_START.test(trimmed)) {
      findings.push({
        line: index + 1,
        text: trimmed.slice(0, 80),
        openedAt: prevOpenLine.line,
        openedIndent: prevOpenLine.indent,
      });
    }
    prevOpenLine = OPENS_BLOCK.test(line) ? { line: index + 1, indent } : null;
  }
  return findings;
}

/** Files this app actually ships and runs (node_modules, .git and the packaged output are skipped). */
function sourceFiles(root) {
  const out = [];
  const skipDirs = new Set(['node_modules', '.git', 'out', 'dist', 'coverage', '.cache', 'releases']);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.js')) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out.sort();
}

function lint(root) {
  const problems = [];
  for (const file of sourceFiles(root)) {
    for (const finding of findSuspiciousDedents(fs.readFileSync(file, 'utf8'))) {
      problems.push({ file: path.relative(root, file), ...finding });
    }
  }
  return problems;
}

module.exports = { findSuspiciousDedents, sourceFiles, lint };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const files = sourceFiles(root);
  const problems = lint(root);
  for (const problem of problems) {
    console.log(`${problem.file}:${problem.line}: statement at column 0 right after a block opened at indent ${problem.openedIndent} (block opened on line ${problem.openedAt}): ${problem.text}`);
  }
  if (problems.length) {
    console.error(`lint-structure: ${problems.length} problem(s). Check the scope of every name used on those lines.`);
    process.exit(1);
  }
  console.log(`lint-structure: ${files.length} file(s) checked, no dedented block starts found`);
}
