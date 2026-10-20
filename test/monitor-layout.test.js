'use strict';

/*
 * The Monitor panel is a CSS grid whose row template is written by hand. When D6 inserted the server
 * switcher row between the header and the scroll area, the template still said `auto 1fr`: the
 * switcher landed on the `1fr` track, absorbed every leftover pixel of height, and its buttons - flex
 * items, `align-items: stretch` by default - were rendered as three tall capsules (#25).
 *
 * Nothing in the suite could see that, because it is pure layout. So the relationship between the
 * markup and the template is asserted here: the number of in-flow children of the panel must not
 * exceed the number of explicit row tracks, and the switcher row must never let its buttons stretch.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'renderer', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');

/** Direct children of the element with `id`, skipping absolutely positioned decorations. */
function directChildren(id, skipClassFragment) {
  const open = new RegExp(`<([a-z0-9]+)[^>]*id="${id}"[^>]*>`).exec(HTML);
  assert.ok(open, `#${id} not found in renderer/index.html`);
  const tag = open[1];
  let i = open.index + open[0].length;
  let depth = 1;
  const children = [];
  const token = /<([a-z0-9]+)([^>]*?)\/?>|<\/([a-z0-9]+)>/g;
  token.lastIndex = i;
  let match;
  while ((match = token.exec(HTML))) {
    if (match[3]) {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
    const selfClosing = match[0].endsWith('/>');
    if (depth === 1) {
      const classes = /class="([^"]*)"/.exec(match[2] || '');
      const cls = classes ? classes[1] : '';
      if (!skipClassFragment || !cls.includes(skipClassFragment)) children.push({ tag: match[1], cls });
    }
    if (!selfClosing) depth += 1;
  }
  return children;
}

/**
 * The declarations of every top-level rule whose selector list contains `selector`. Walked by hand
 * instead of one regex: the stylesheet has @media blocks, and a `[^{}]*` body pattern mis-pairs the
 * nested braces and shifts every following rule by one.
 */
function ruleBody(selector) {
  const bodies = [];
  let i = 0;
  let selectorStart = 0;
  while (i < CSS.length) {
    const ch = CSS[i];
    if (ch === '{') {
      const selectorText = CSS.slice(selectorStart, i).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      const bodyStart = i + 1;
      let depth = 1;
      let j = bodyStart;
      while (j < CSS.length && depth > 0) {
        if (CSS[j] === '{') depth += 1;
        else if (CSS[j] === '}') depth -= 1;
        j += 1;
      }
      const body = CSS.slice(bodyStart, j - 1);
      const selectors = selectorText.split(',').map((part) => part.replace(/\s+/g, ' ').trim());
      if (selectors.includes(selector)) bodies.push(body);
      selectorStart = j;
      i = j;
      continue;
    }
    i += 1;
  }
  assert.ok(bodies.length, `no rule for ${selector} in renderer/styles.css`);
  return bodies.join('\n');
}

test('the monitor panel defines one grid row per in-flow child (#25)', () => {
  const children = directChildren('monitorView', 'mon-resizer');
  assert.ok(children.length >= 3, `expected the header, the switcher and the scroll area, got ${JSON.stringify(children)}`);
  const body = ruleBody('.monitor-view');
  const template = /grid-template-rows:\s*([^;]+);/.exec(body);
  assert.ok(template, '.monitor-view must declare grid-template-rows explicitly');
  const tracks = template[1].trim().split(/\s+/).filter(Boolean);
  assert.ok(
    tracks.length >= children.length,
    `.monitor-view has ${children.length} in-flow children (${children.map((c) => c.cls || c.tag).join(', ')}) but only ${tracks.length} grid rows (${template[1].trim()}): the extra child lands on the 1fr track and swallows the panel's leftover height`,
  );
});

test('the server switcher never stretches its buttons into capsules (#25)', () => {
  const body = ruleBody('.mon-servers');
  const align = /align-items:\s*([^;]+);/.exec(body);
  assert.ok(align, '.mon-servers must pin align-items - the default is stretch, which turns a pill button into a stadium');
  assert.notEqual(align[1].trim(), 'stretch', 'align-items: stretch is what made the switcher tall');
  const pill = ruleBody('.mon-server');
  assert.match(pill, /border-radius:\s*999px/, 'the switcher is a pill: it must not be allowed to grow tall');
});
