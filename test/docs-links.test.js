'use strict';

/*
 * The documentation is split by topic (README.md is the index, docs/*.md hold the reference), which
 * moves every anchor and every relative link. A split is exactly the kind of change that breaks links
 * silently: GitHub renders a broken anchor as a page that opens at the top, and a broken path as a 404,
 * both only noticed by whoever was trying to read something.
 *
 * So the links are checked the same way the code is:
 *
 *   - every relative link in README.md and docs/*.md names a file that exists,
 *   - every #anchor (same file or another file) names a heading that exists, using GitHub's own slug
 *     rules - lowercase, punctuation dropped, each space becoming a hyphen,
 *   - every docs/*.md is reachable from the README index table, so a new page cannot be added and
 *     left orphaned,
 *   - README.md stays an index rather than growing back into one long file.
 *
 * Links inside fenced blocks and inline code spans are ignored: the docs quote markdown syntax itself
 * (`[text](url)` in the links section), and that is an example, not a link.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');

const pages = ['README.md']
  .concat(fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md')).sort().map((f) => `docs/${f}`));

// every page name in this file uses forward slashes; only the filesystem calls need the native form
function abs(rel) {
  return path.join(ROOT, rel.split('/').join(path.sep));
}

function read(rel) {
  return fs.readFileSync(abs(rel), 'utf8').replace(/\r\n/g, '\n');
}

// GitHub's anchor rules: lowercase, everything that is not a letter, a number, an underscore, a hyphen
// or a space dropped (CJK letters count as letters - the Language heading keeps its 繁體中文), then each
// space becomes a hyphen - so "Bash mode (`!`) and slash commands (`/`)" is
// bash-mode--and-slash-commands-, double hyphen and trailing hyphen included.
function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '')
    .replace(/ /g, '-');
}

function headings(text) {
  const found = new Set();
  let fence = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const match = /^#{1,6} (.*)$/.exec(line);
    if (match) found.add(slug(match[1]));
  }
  return found;
}

// links outside fenced blocks, with inline code spans removed first
function links(text) {
  const out = [];
  let fence = false;
  let lineNo = 0;
  for (const raw of text.split('\n')) {
    lineNo++;
    if (raw.trimStart().startsWith('```')) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const line = raw.replace(/`[^`]*`/g, '');
    for (const match of line.matchAll(/\]\(([^)\s]+)\)/g)) out.push({ target: match[1], line: lineNo });
  }
  return out;
}

const cache = new Map(pages.map((rel) => [rel, read(rel)]));
const anchors = new Map(pages.map((rel) => [rel, headings(cache.get(rel))]));

test('every relative link in the docs points at a file that exists', () => {
  const broken = [];
  for (const rel of pages) {
    for (const { target, line } of links(cache.get(rel))) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [file] = target.split('#');
      if (!file) continue;
      const resolved = path.resolve(path.dirname(abs(rel)), file.split('/').join(path.sep));
      if (!fs.existsSync(resolved)) broken.push(`${rel}:${line} -> ${target}`);
    }
  }
  assert.deepEqual(broken, [], 'links to files that are not there');
});

test('every #anchor in the docs names a heading that exists', () => {
  const broken = [];
  for (const rel of pages) {
    for (const { target, line } of links(cache.get(rel))) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [file, anchor] = target.split('#');
      if (!anchor) continue;
      const where = file
        ? path
            .relative(ROOT, path.resolve(path.dirname(abs(rel)), file.split('/').join(path.sep)))
            .split(path.sep)
            .join('/')
        : rel;
      if (!pages.includes(where)) {
        broken.push(`${rel}:${line} -> ${target} (no such page)`);
        continue;
      }
      if (!anchors.get(where).has(anchor)) broken.push(`${rel}:${line} -> ${target}`);
    }
  }
  assert.deepEqual(broken, [], 'anchors that lead nowhere');
});

test('the README index lists every docs page, and every listed page exists', () => {
  const readme = cache.get('README.md');
  const listed = new Set(
    [...readme.matchAll(/\]\((docs\/[^)#]+\.md)/g)].map((m) => m[1]),
  );
  const onDisk = pages.filter((rel) => rel !== 'README.md');

  const missingFromIndex = onDisk.filter((rel) => !listed.has(rel));
  assert.deepEqual(missingFromIndex, [], 'docs pages the README does not link');

  const phantom = [...listed].filter((rel) => !fs.existsSync(abs(rel)));
  assert.deepEqual(phantom, [], 'the README links docs pages that do not exist');
});

test('README.md stays an index, not the whole manual again', () => {
  const lines = cache.get('README.md').split('\n').length;
  assert.ok(lines <= 320, `README.md is ${lines} lines - move the detail into docs/ and link it`);
});

test('the docs pages that exist cover the topics they are named for', () => {
  // guards against a page being renamed and the index quietly drifting: each row of the README table
  // has to name the file it links, so a rename has to touch both.
  const readme = cache.get('README.md');
  for (const rel of pages.filter((p) => p !== 'README.md')) {
    const base = path.basename(rel);
    assert.ok(readme.includes(`](${rel})`), `README does not link ${base}`);
    assert.ok(anchors.get(rel).size > 0, `${base} has no headings`);
  }
});
