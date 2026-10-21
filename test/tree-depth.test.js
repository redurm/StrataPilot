'use strict';

/*
 * Regression test for the session tree's indentation (B1).
 *
 * pi's session tree is a chain: every entry's parent is the entry before it. The tree view used to
 * indent one level per entry, so a 76-entry session was 76 levels deep - 8 + 76*14 = 1072px of
 * padding-left inside a 900px modal. With the global `box-sizing: border-box` that ate the row's
 * content box, so the text and the time column overflowed, the time drifted right as the rows got
 * deeper, and the list grew a horizontal scrollbar. It also made the on-path stripe (a border-left,
 * which sits outside the indent) look like a trunk running down the whole list.
 *
 * flattenTree() now indents one level per branch point instead of one per entry, and caps the level.
 * Like queue-label.test.js, this pulls the function's source out of the browser script and runs it
 * with plain objects: no Electron, no DOM.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = ['renderer/app.js', 'renderer/tree.js', 'renderer/storage.js', 'renderer/settings.js', 'renderer/modals.js', 'renderer/composer.js', 'renderer/transcript.js']
  .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))
  .join(String.fromCharCode(10));

/** Return the text of a top-level `function name(...) { ... }` in the renderer source. */
function functionSource(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `renderer/app.js, tree.js or storage.js no longer defines ${name}()`);
  const open = appSource.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < appSource.length; i++) {
    if (appSource[i] === '{') depth++;
    else if (appSource[i] === '}' && --depth === 0) return appSource.slice(start, i + 1);
  }
  throw new Error(`${name}() has unbalanced braces`);
}

const flattenTree = new Function(`return (${functionSource('flattenTree')})`)();

/** A chain of n entries: each one's parent is the one before it, like a real session. */
function chain(n) {
  const nodes = [];
  for (let i = 0; i < n; i++) nodes.push({ entry: { id: `e${i}`, type: 'message' }, children: [] });
  for (let i = 1; i < n; i++) nodes[i - 1].children.push(nodes[i]);
  return { tree: [nodes[0]], ids: nodes.map((node) => node.entry.id) };
}

test('a linear session renders flat: 76 chained entries never exceed level 0', () => {
  const { tree, ids } = chain(76);
  const rows = flattenTree(tree, new Set(ids));
  assert.equal(rows.length, 76);
  assert.deepEqual(rows.map((row) => row.level), new Array(76).fill(0));
  assert.deepEqual(rows.map((row) => row.node.entry.id), ids, 'depth-first order is kept');
  assert.ok(rows.every((row) => row.on), 'the whole chain is the branch you are on');
  assert.ok(rows.every((row) => row.siblings <= 1), '0 branch points means no row has 2+ children');
});

test('indent grows one level per branch point, not per entry', () => {
  // root -> a -> a1 -> a2 (kept branch) and root -> b -> b1 (dropped branch)
  const leaf = (id) => ({ entry: { id }, children: [] });
  const a2 = leaf('a2');
  const a1 = { entry: { id: 'a1' }, children: [a2] };
  const a = { entry: { id: 'a' }, children: [a1] };
  const b1 = leaf('b1');
  const b = { entry: { id: 'b' }, children: [b1] };
  const root = { entry: { id: 'root' }, children: [a, b] };

  const rows = flattenTree([root], new Set(['root', 'a', 'a1', 'a2']));
  const level = Object.fromEntries(rows.map((row) => [row.node.entry.id, row.level]));
  const on = Object.fromEntries(rows.map((row) => [row.node.entry.id, row.on]));

  assert.equal(level.root, 0);
  assert.equal(level.a, 1, 'a child of a branch point nests one level');
  assert.equal(level.a1, 1, 'a single child keeps its parent level (path compression)');
  assert.equal(level.a2, 1);
  assert.equal(level.b, 1);
  assert.equal(level.b1, 1);

  assert.ok(on.root && on.a && on.a1 && on.a2, 'the kept branch is on-path');
  assert.ok(!on.b && !on.b1, 'the dropped branch is dimmed all the way down');
  assert.equal(rows[0].siblings, 2, 'the branch point reports its sibling count for the badge');
});

test('the on-path child is listed first at a branch point', () => {
  const keep = { entry: { id: 'keep' }, children: [] };
  const drop = { entry: { id: 'drop' }, children: [] };
  const root = { entry: { id: 'root' }, children: [drop, keep] };
  const rows = flattenTree([root], new Set(['root', 'keep']));
  assert.deepEqual(rows.map((row) => row.node.entry.id), ['root', 'keep', 'drop']);
});

test('a fork storm stays inside the modal', () => {
  // every node forks in two: depth grows fast, so the level has to be capped
  const leaf = (id) => ({ entry: { id }, children: [] });
  let node = leaf('end');
  for (let i = 39; i >= 0; i--) node = { entry: { id: `n${i}` }, children: [node, leaf(`x${i}`)] };
  const rows = flattenTree([node], new Set(), 12);
  assert.equal(rows.length, 81, 'every entry is still listed, deep or not');
  assert.ok(rows.every((row) => row.level <= 12), 'no row is indented past the cap');
});

test('the renderer indents with --indent so css can draw the on-path tick at the same offset', () => {
  assert.ok(
    /setProperty\('--indent'/.test(appSource),
    'the row must set --indent, not padding-left, or the on-path tick and the indent drift apart',
  );
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  assert.ok(/--indent/.test(css) && /::before/.test(css), 'the on-path tick must follow --indent');
  assert.ok(!/border-left-color:\s*var\(--accent\)/.test(css), 'a border-left sits outside the indent');
  assert.ok(/overflow-x:\s*hidden/.test(css), 'the tree list must not scroll sideways');
});
