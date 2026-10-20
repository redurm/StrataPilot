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

/**
 * GitHub disambiguates repeated headings by appending -1, -2, ... to every occurrence after the
 * first. Without that, a link to the SECOND "## Testing" in a page resolved against the slug of the
 * first and looked fine while pointing at the wrong heading (or at nothing, once the first one was
 * renamed) (#13).
 */
function headings(text) {
  const found = new Set();
  const seen = new Map();
  let fence = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const match = /^#{1,6} (.*)$/.exec(line);
    if (!match) continue;
    const base = slug(match[1]);
    const repeats = seen.get(base) || 0;
    seen.set(base, repeats + 1);
    found.add(repeats === 0 ? base : `${base}-${repeats}`);
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

/**
 * The page list and the page contents used to be read at module load, before any test ran: a new doc
 * file silently changed the set of pages under every test, and a read failure took the whole file down
 * with an error that looked like a broken test rather than a missing doc (#13). Both are read on
 * demand now, inside the test that needs them.
 */
function pageNames() {
  return ['README.md']
    .concat(fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md')).sort().map((f) => `docs/${f}`));
}

const contentCache = new Map();

function pageContent(rel) {
  if (!contentCache.has(rel)) contentCache.set(rel, read(rel));
  return contentCache.get(rel);
}

const anchorCache = new Map();

function anchorsOf(rel) {
  if (!anchorCache.has(rel)) anchorCache.set(rel, headings(pageContent(rel)));
  return anchorCache.get(rel);
}

test('every relative link in the docs points at a file that exists', () => {
  const pages = pageNames();
  const broken = [];
  for (const rel of pages) {
    for (const { target, line } of links(pageContent(rel))) {
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
  const pages = pageNames();
  const broken = [];
  for (const rel of pages) {
    for (const { target, line } of links(pageContent(rel))) {
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
      if (!anchorsOf(where).has(anchor)) broken.push(`${rel}:${line} -> ${target}`);
    }
  }
  assert.deepEqual(broken, [], 'anchors that lead nowhere');
});

test('the README index lists every docs page, and every listed page exists', () => {
  const readme = pageContent('README.md');
  const listed = new Set(
    [...readme.matchAll(/\]\((docs\/[^)#]+\.md)/g)].map((m) => m[1]),
  );
  const onDisk = pageNames().filter((rel) => rel !== 'README.md');

  const missingFromIndex = onDisk.filter((rel) => !listed.has(rel));
  assert.deepEqual(missingFromIndex, [], 'docs pages the README does not link');

  const phantom = [...listed].filter((rel) => !fs.existsSync(abs(rel)));
  assert.deepEqual(phantom, [], 'the README links docs pages that do not exist');
});

test('README.md stays an index, not the whole manual again', () => {
  const lines = pageContent('README.md').split('\n').length;
  assert.ok(lines <= 320, `README.md is ${lines} lines - move the detail into docs/ and link it`);
});

test('the docs pages that exist cover the topics they are named for', () => {
  // guards against a page being renamed and the index quietly drifting: each row of the README table
  // has to name the file it links, so a rename has to touch both.
  const readme = pageContent('README.md');
  for (const rel of pageNames().filter((p) => p !== 'README.md')) {
    const base = path.basename(rel);
    assert.ok(readme.includes(`](${rel})`), `README does not link ${base}`);
    assert.ok(anchorsOf(rel).size > 0, `${base} has no headings`);
  }
});

test('a page with two identical headings gets GitHub -1 suffix, and a link to it resolves (#13)', () => {
  const page = ['# Title', '', '## Testing', '', 'text', '', '## Testing', '', 'more'].join('\n');
  const found = headings(page);
  assert.ok(found.has('testing'), 'the first occurrence keeps the bare slug');
  assert.ok(found.has('testing-1'), 'GitHub disambiguates the second one');
  // the old slug() mapped both to `testing`, so a link to the second one looked valid while pointing
  // at the wrong heading - and renaming the first made the link dead without any test noticing
  assert.ok(!found.has('testing-2') || page.includes('## Testing\n## Testing\n## Testing'));
});
