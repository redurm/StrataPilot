'use strict';

/*
 * Minimal, dependency-free markdown renderer for chat output.
 *
 * The syntax list is deliberately the one a model actually writes, not the whole CommonMark set: the
 * coverage cases were lifted from the sibling project MarkdownViewer (its `web/check.mjs`), while the
 * engine stays hand-written so this repo keeps zero runtime dependencies and no build step
 * (docs/INSTALL.md). What is NOT here is chosen, not missing: raw HTML (every character is escaped),
 * `==mark==` / `^sup^` / `~sub~` (`~` and `^` carry too much meaning in shell and regex text a model
 * pastes), math and Mermaid (those are handed to an external viewer, see the `viewer` button).
 *
 * Deviations from CommonMark, all of them deliberate for chat:
 *   - a single newline inside a paragraph is a line break, like every chat UI
 *   - `text` followed by `---` is a thematic break, NOT a setext h2: a model uses `---` as a
 *     separator constantly, and turning the line above it into a heading mangles the answer. `===`
 *     under a paragraph does become a heading, because nothing else means that.
 *   - images are a chip (alt text + link), never an `<img>`: CSP `img-src 'self' data: blob:` blocks
 *     remote images, and a broken image icon in the transcript is worse than being told one exists
 *   - `javascript:` and other non-http(s)/mailto targets are rendered as text, not as a link
 */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const URL_RE = /https?:\/\/[^\s<>"'，。、；：！？（）「」『』《》〈〉【】]+/g;
// trailing ascii punctuation that usually ends a sentence rather than the url
const TRAILING_PUNCT = /[,.;:!?]+$/;

function anchorTag(url, label) {
  return `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`;
}

// linkify bare urls inside already-escaped text
function linkifyBareUrls(escaped) {
  return escaped.replace(URL_RE, (url) => {
    const match = TRAILING_PUNCT.exec(url);
    const trailing = match ? match[0] : '';
    const clean = trailing ? url.slice(0, url.length - trailing.length) : url;
    return anchorTag(clean, clean) + trailing;
  });
}

// plain text (tool output, thinking, user messages, notes) -> escaped + clickable urls
function linkify(source) {
  return linkifyBareUrls(escapeHtml(source == null ? '' : source));
}

/* ------------------------------------------------------------------ */
/* inline                                                              */
/* ------------------------------------------------------------------ */

const NUL = String.fromCharCode(0);

/**
 * A link or code span is taken out of the text and put back at the end, so the passes that follow
 * (bare urls, bold, italic) cannot rewrite its content or its href. NUL-delimited markers cannot
 * appear in the input: mdToHtml strips NUL from the source first.
 */
function makeStash() {
  const held = [];
  return {
    put(html) {
      held.push(html);
      return `${NUL}S${held.length - 1}${NUL}`;
    },
restore(text) {
    // to a fixpoint: a link label put its own code span into the same stash, so restoring the anchor
    // uncovers another marker - one pass would leave the literal text "S0" in the output
    let out = text;
    const pattern = new RegExp(NUL + 'S(\\d+)' + NUL, 'g');
    for (let pass = 0; pass < 8; pass++) {
      const next = out.replace(pattern, (_m, index) => held[Number(index)]);
      if (next === out) break;
      out = next;
    }
    return out;
  },
  };
}

/** http(s) and mailto only: a chat answer is not a place to run a scheme handler. */
function safeHref(href) {
  const bare = String(href || '')
    .replace(/&amp;/g, '&')
    .replace(/^&lt;|&gt;$/g, '')
    .trim();
  return /^(https?:|mailto:)/i.test(bare) ? href : '';
}

/** bold / italic / strike / inline code, without touching links (labels run through this). */
function inlineStyle(text, stash) {
  let out = text;
  // code spans first: their content is never markdown-processed (`x **y** z` stays literal)
  out = out.replace(/``([^`\n]+?)``|`([^`\n]+?)`/g, (_m, double, single) =>
    stash.put(`<code class="inline">${(double == null ? single : double).trim()}</code>`),
  );
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return out;
}

// [label](url) / ![alt](url) - the label may carry code and emphasis, so it is formatted too
const LINK_INLINE_RE = /(!?)\[([^\]]*)\]\(((?:&lt;[^&\n]*&gt;|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*))(?:[ \t]+(?:&quot;[^&\n]*?&quot;|'[^&\n]*?'))?\)/g;
// [label][ref], [label][] and the shortcut [label] form, resolved against the reference map
const LINK_REF_RE = /(!?)\[([^\]]+)\]\[([^\]]*)\]/g;
const LINK_SHORT_RE = /(!?)\[([^\]]+)\](?![([])/g;

function linkHtml(image, label, href, stash) {
  // `url "title"` is one GFM form of a title; the quotes are already escaped here
  const target = String(href || '').replace(/[ \t]+(?:&quot;[^&]*&quot;|'[^']*')[ \t]*$/, '').trim();
  const safe = safeHref(target);
  const text = inlineStyle(label, stash);
  if (!safe) {
    // an unsafe or empty target: say what was written instead of linking it
    return stash.put(`<span class="md-broken-link">${text}</span>`);
  }
  // CSP blocks remote <img>, so an image reference becomes a chip that still links to it
  if (image) return stash.put(`<span class="md-img">image ${anchorTag(safe, text || safe)}</span>`);
  return stash.put(anchorTag(safe, text));
}

/**
 * Inline pass. `text` is already escaped; `refs` is the link-reference map ("label" -> url) the block
 * pass collected, so it survives the recursive calls that lists and blockquotes make.
 */
function inlineMarkdown(text, refs) {
  const stash = makeStash();
  let out = text;
  out = out.replace(LINK_INLINE_RE, (_m, image, label, href) => linkHtml(image, label, href.trim(), stash));
  out = out.replace(LINK_REF_RE, (_m, image, label, key) => {
    const wanted = (key || label).trim().toLowerCase();
    const found = refs ? refs.get(wanted) : undefined;
    // no definition: leave the source as written, brackets and all, and let the shortcut pass below
    // see the trailing part rather than inventing a link
    if (!found) return image ? `![${label}][${key}]` : `[${label}][${key}]`;
    return linkHtml(image, label, found, stash);
  });
  if (refs && refs.size) {
    out = out.replace(LINK_SHORT_RE, (_m, image, label) => {
      const found = refs.get(label.trim().toLowerCase());
      if (!found) return `${image}[${label}]`;
      return linkHtml(image, label, found, stash);
    });
  }
  // <https://example.com> autolink, on already-escaped text
out = out.replace(/&lt;((?:https?|mailto):[^\s&]+)&gt;/g, (_m, url) => stash.put(anchorTag(url, url)));
  out = linkifyBareUrls(out);
  out = inlineStyle(out, stash);
  return stash.restore(out);
}

/* ------------------------------------------------------------------ */
/* blocks                                                              */
/* ------------------------------------------------------------------ */

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const HR_RE = /^ {0,3}(?:(?:\*|-|_)[ \t]*){3,}$/;
const SETEXT_H1_RE = /^ {0,3}=+[ \t]*$/;
const QUOTE_RE = /^ {0,3}>/;
const ITEM_RE = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const INDENT_CODE_RE = /^ {4}(\S.*)$/;
const TASK_RE = /^\[([ xX])\][ \t]+([\s\S]*)$/;
const ALERT_RE = /^\[!(note|tip|important|warning|caution)\]$/i;
const LINK_DEF_RE = /^ {0,3}\[([^\]]+)\]:[ \t]*(\S+)[ \t]*(?:\S.*)?$/;

const ALERT_LABEL = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function dedent(line, columns) {
  let cut = 0;
  while (cut < columns && cut < line.length && line[cut] === ' ') cut++;
  return line.slice(cut);
}

function isTableStart(lines, index) {
  const line = (lines[index] || '').replace(/\s+$/, '');
  if (!isTableHeaderLine(line)) return false;
  return index + 1 < lines.length && isDelimiterRow(lines[index + 1]);
}

/** Does this line start a block that must interrupt an open paragraph? */
function startsBlock(lines, index) {
  const line = lines[index];
  if (readFence(lines, index)) return true;
  if (ATX_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line) || SETEXT_H1_RE.test(line)) return true;
  if (ITEM_RE.test(line) && indentOf(line) <= 3) return true;
  return isTableStart(lines, index);
}

/**
 * Reference definitions (`[label]: url`) are read first and removed from the block stream, so they
 * neither render as paragraphs nor leak into the next one. A fence is skipped whole: a `[x]: y` line
 * inside a code sample is a line of code, not a definition.
 */
function collectLinkDefinitions(lines) {
  const refs = new Map();
  const kept = [];
  for (let index = 0; index < lines.length; index++) {
    const fence = readFence(lines, index);
    if (fence) {
      // copy the fence whole: a `[label]: url` line inside a code sample is a line of code, and the
      // sample itself has to reach the block pass intact
      for (let stop = index; stop < fence.end; stop++) kept.push(lines[stop]);
      index = fence.end - 1;
      continue;
    }
    const def = LINK_DEF_RE.exec(lines[index]);
    if (def && !refs.has(def[1].trim().toLowerCase())) {
      const href = def[2].replace(/^&lt;|&gt;$/g, '');
      if (safeHref(href)) refs.set(def[1].trim().toLowerCase(), href);
      continue;
    }
    kept.push(lines[index]);
  }
  return { refs, lines: kept };
}

/** A closing fence: the marker character only, at least as many of them, trailing blanks allowed. */
function isFenceCloser(line, marker) {
  if (indentOf(line) > 3) return false;
  const trimmed = line.trimEnd();
  if (trimmed.length < marker.length) return false;
  for (let index = 0; index < trimmed.length; index++) {
    if (trimmed[index] !== marker[0]) return false;
  }
  return true;
}

/**
 * The fence that opens at `index`: the line it ends on, and whether anything closed it at all. One place
 * decides what a fence is, so the block pass, the paragraph pass and the link-definition pass cannot
 * disagree about it. The two rules that are only obvious when they sit together: a backtick inside the
 * info string means this is no fence at all, and a fence is closed only by a run of the same character at
 * least as long as the one that opened it - which is what lets a model quote a markdown sample that
 * contains ```. The regex pre-pass this replaces turned that case into the literal text `CODE0`.
 */
function readFence(lines, index) {
  const match = FENCE_RE.exec(lines[index]);
  if (!match) return null;
  if (match[1][0] === '`' && match[2].includes('`')) return null;
  const marker = match[1];
  let end = lines.length;
  let closed = false;
  for (let scan = index + 1; scan < lines.length; scan++) {
    if (isFenceCloser(lines[scan], marker)) {
      end = scan + 1;
      closed = true;
      break;
    }
  }
  return { match, end, closed };
}

function codeBarHtml(lang) {
  const label = escapeHtml(lang || 'code');
  const viewer = lang === 'mermaid'
    ? '<button class="copy-btn" type="button" data-viewer title="open this diagram in the external markdown viewer">viewer</button>'
    : '';
  return `<div class="code-bar"><span>${label}</span>${viewer}<button class="copy-btn" type="button" data-copy>copy</button></div>`;
}

function renderFence(lines, start, fence) {
  const info = fence.match[2].trim();
  const body = [];
  const indent = indentOf(lines[start]);
  // `end` is the line after the closing fence; an unterminated fence has no such line
  const stop = fence.closed ? fence.end - 1 : fence.end;
  for (let index = start + 1; index < stop; index++) body.push(dedent(lines[index], indent));
  const lang = (info.split(/[^\w+#.+-]/)[0] || '').toLowerCase();
  const code = body.join('\n').replace(/\n+$/, '');
  const html = `<pre class="code" data-lang="${escapeHtml(lang)}">${codeBarHtml(lang)}<code>${codeHtml(code, lang)}</code></pre>`;
  return { html, next: fence.end };
}

function renderIndentedCode(lines, start) {
  const body = [];
  let index = start;
  while (index < lines.length) {
    const match = INDENT_CODE_RE.exec(lines[index]);
    if (match) body.push(match[1]);
    else if (!lines[index].trim() && INDENT_CODE_RE.test(lines[index + 1] || '')) body.push('');
    else break;
    index++;
  }
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const code = body.join('\n');
  return { html: `<pre class="code" data-lang="indented">${codeBarHtml('')}<code>${codeHtml(code, '')}</code></pre>`, next: index };
}

function renderQuote(lines, start, refs) {
  const inner = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (QUOTE_RE.test(line)) {
      inner.push(line.replace(/^ {0,3}> ?/, ''));
      index++;
      continue;
    }
    // lazy continuation: the model wrapped the quote and did not repeat the ">"
    if (line.trim() && inner.length && !startsBlock(lines, index) && !isTableStart(lines, index)) {
      inner.push(line.trim());
      index++;
      continue;
    }
    break;
  }
  const body = renderBlocks(inner, refs, { tight: true });
  const alert = ALERT_RE.exec((inner[0] || '').trim());
  if (alert) {
    const kind = alert[1].toLowerCase();
    const rest = renderBlocks(inner.slice(1), refs, { tight: true });
    return {
      html: `<div class="md-alert md-alert-${kind}"><p class="md-alert-title">${ALERT_LABEL[kind]}</p>${rest}</div>`,
      next: index,
    };
  }
  return { html: `<blockquote>${body}</blockquote>`, next: index };
}

function renderItem(item, refs, loose) {
  let lines = item.lines;
  let attrs = '';
  let box = '';
  const task = lines.length ? TASK_RE.exec(lines[0]) : null;
  if (task) {
    attrs = ' class="task"';
    box = `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}>`;
    lines = [task[2]].concat(lines.slice(1));
  }
  return `<li${attrs}>${box}${renderBlocks(lines, refs, { tight: !loose })}</li>`;
}

function renderList(lines, start, refs) {
  const first = ITEM_RE.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const startNumber = ordered ? Number(first[2].replace(/\D+$/, '')) : 1;
  const items = [];
  let loose = false;
  let current = null;
  let index = start;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      const next = nextNonBlank(lines, index);
      if (next < 0) break;
      const candidate = ITEM_RE.exec(lines[next]);
      const candidateIndent = indentOf(lines[next]);
      const sameKind = candidate && /\d/.test(candidate[2]) === ordered;
      const stillItem = candidate && candidateIndent >= baseIndent && sameKind;
      const stillContent = !candidate && candidateIndent > baseIndent;
      if (!stillItem && !stillContent) break;
      // a blank line inside the list makes it loose: items keep their paragraph breaks
      loose = true;
      if (current && !candidate && candidateIndent >= current.contentIndent) current.lines.push('');
      index = next;
      continue;
    }
    const match = ITEM_RE.exec(line);
    if (match && match[1].length === baseIndent && /\d/.test(match[2]) === ordered) {
      const contentIndent = baseIndent + match[2].length + Math.min(match[3].length, 4);
      current = { lines: [match[4]], contentIndent };
      items.push(current);
      index++;
      continue;
    }
    if (match && current && match[1].length > baseIndent) {
      // a deeper marker belongs to the open item: a nested list, resolved by recursion
      current.lines.push(dedent(line, current.contentIndent));
      index++;
      continue;
    }
    if (current) {
      const indent = indentOf(line);
      if (indent >= current.contentIndent) {
        current.lines.push(dedent(line, current.contentIndent));
        index++;
        continue;
      }
      // lazy continuation: `- item` then a wrapped line without a marker is the same item
      if (!startsBlock(lines, index) && !isTableStart(lines, index)) {
        current.lines.push(line.trim());
        index++;
        continue;
      }
    }
    break;
  }

  const tag = ordered ? 'ol' : 'ul';
  const tasks = items.some((item) => TASK_RE.test(item.lines[0] || ''));
  const attrs = `${ordered && startNumber !== 1 ? ` start="${startNumber}"` : ''}${tasks ? ' class="md-task-list"' : ''}`;
  const body = items.map((item) => renderItem(item, refs, loose)).join('\n');
  return { html: `<${tag}${attrs}>\n${body}\n</${tag}>`, next: index };
}

function nextNonBlank(lines, from) {
  for (let index = from + 1; index < lines.length; index++) {
    if (lines[index].trim()) return index;
  }
  return -1;
}

/* ---- GFM tables ---- */

// split a table row on unescaped pipes, dropping the optional outer pipes
function splitTableRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells = [];
  let current = '';
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '\\' && row[i + 1] === '|') {
      current += '|';
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function isTableLine(line) {
  return line.includes('|');
}

function isTableHeaderLine(line) {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  return splitTableRow(trimmed).length >= 2 || (trimmed.startsWith('|') && trimmed.endsWith('|'));
}

function isDelimiterRow(line) {
  // require a pipe: otherwise a setext-style underline (`---` under a paragraph
  // line that happens to contain a pipe) would be mistaken for a table
  if (!line.includes('|')) return false;
  const cells = splitTableRow(line);
  return cells.length >= 1 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

function alignOf(cell) {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return '';
}

function cellTag(align) {
  return align ? ` class="al-${align}"` : '';
}

function renderTable(lines, start, refs) {
  let index = start;
  const header = splitTableRow(lines[index]);
  const aligns = splitTableRow(lines[index + 1]).map(alignOf);
  index += 2;
  const rows = [];
  while (index < lines.length && lines[index].trim() && isTableLine(lines[index].replace(/\s+$/, ''))) {
    if (readFence(lines, index) || QUOTE_RE.test(lines[index]) || ITEM_RE.test(lines[index])) break;
    rows.push(splitTableRow(lines[index].replace(/\s+$/, '')));
    index++;
  }
  const head = header.map((cell, i) => `<th${cellTag(aligns[i])}>${inlineMarkdown(escapeHtml(cell), refs)}</th>`).join('');
  const body = rows
    .map((cells) => `<tr>${header.map((_h, i) => `<td${cellTag(aligns[i])}>${inlineMarkdown(escapeHtml(cells[i] == null ? '' : cells[i]), refs)}</td>`).join('')}</tr>`)
    .join('');
  return {
    html: `<div class="table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    next: index,
  };
}

/** One paragraph or, in a tight list / blockquote, its inline content with hard line breaks. */
function paragraphHtml(collected, refs, tight) {
  const inner = inlineMarkdown(escapeHtml(collected.join('\n')), refs).replace(/\n/g, '<br>');
  return tight ? inner : `<p>${inner}</p>`;
}

function renderBlocks(lines, refs, options = {}) {
  const tight = !!options.tight;
  const html = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    const fence = readFence(lines, index);
    if (fence) {
      const block = renderFence(lines, index, fence);
      html.push(block.html);
      index = block.next;
      continue;
    }
    const atx = ATX_RE.exec(line);
    if (atx) {
      const level = atx[1].length;
      const text = (atx[2] || '').replace(/\s+$/, '');
      if (text) html.push(`<h${level} class="md-h">${inlineMarkdown(escapeHtml(text), refs)}</h${level}>`);
      index++;
      continue;
    }
    if (HR_RE.test(line)) {
      html.push('<hr>');
      index++;
      continue;
    }
    if (QUOTE_RE.test(line)) {
      const block = renderQuote(lines, index, refs);
      html.push(block.html);
      index = block.next;
      continue;
    }
    const item = ITEM_RE.exec(line);
    if (item && indentOf(line) <= 3) {
      const block = renderList(lines, index, refs);
      html.push(block.html);
      index = block.next;
      continue;
    }
    if (isTableStart(lines, index)) {
      const block = renderTable(lines, index, refs);
      html.push(block.html);
      index = block.next;
      continue;
    }
    if (INDENT_CODE_RE.test(line)) {
      const block = renderIndentedCode(lines, index);
      html.push(block.html);
      index = block.next;
      continue;
    }

    // a paragraph swallows everything until a blank line or a real block start (an indented line is
    // not a block start here: indented code cannot interrupt a paragraph)
    const collected = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      (collected.length === 0 || !startsBlock(lines, index))
    ) {
      collected.push(lines[index].replace(/\s+$/, ''));
      index++;
    }
    // setext h1: `Title` then `===`. `---` stays a thematic break on purpose, see the header comment
    if (index < lines.length && SETEXT_H1_RE.test(lines[index])) {
      html.push(`<h1 class="md-h">${paragraphHtml(collected, refs, true)}</h1>`);
      index++;
      continue;
    }
    html.push(paragraphHtml(collected, refs, tight));
  }
  return html.join('\n');
}

/** The bridge to renderer/highlight.js: plain text if that script ever fails to load. */
/**
 * A fence long enough to hold `code` verbatim. CommonMark closes a fence only with a run at least as long
 * as the one that opened it, so a plain triple backtick would end the block early when the text being
 * handed over is itself a fenced block - answers about markdown are full of those, and a Mermaid block can
 * carry a quoted sample. The Markdown Viewer handoff (renderer/app.js) needs this: it rebuilds a fence
 * around text it did not write.
 */
function fenceFor(code) {
  let longest = 0;
  for (const run of String(code == null ? '' : code).match(/`+/g) || []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

function codeHtml(code, lang) {
  if (typeof window !== 'undefined' && typeof window.hlHighlight === 'function') return window.hlHighlight(code, lang);
  if (typeof require === 'function') {
    try {
      return require('./highlight.js').highlightCode(code, lang);
    } catch {
      /* the browser has no require; falling through to escaping is correct there */
    }
  }
  return escapeHtml(code);
}

function mdToHtml(source) {
  if (source == null) return '';
  const text = String(source).replace(/\r\n/g, '\n').replace(/\u0000/g, '');
  const prepared = collectLinkDefinitions(text.split('\n'));
  return renderBlocks(prepared.lines, prepared.refs);
}

if (typeof window !== 'undefined') {
  window.mdToHtml = mdToHtml;
  window.fenceFor = fenceFor;
  window.escapeHtml = escapeHtml;
  window.linkify = linkify;
}

// dual export: the browser keeps the window.* assignments (index.html loads this file as a plain
// <script> under CSP script-src 'self'); Node (unit tests) gets module.exports instead.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mdToHtml, escapeHtml, linkify, codeHtml, fenceFor };
}
