'use strict';

/* Minimal, dependency-free markdown renderer for chat output. */

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

function inlineMarkdown(escaped) {
  let out = escaped;
  // inline code first so its content is not touched by other rules
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => `<code class="inline">${code}</code>`);
  // markdown links: stash them so the bare-url pass cannot rewrite their href
  const anchors = [];
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) => {
    anchors.push(anchorTag(url, text));
    return `\u0000A${anchors.length - 1}\u0000`;
  });
  out = linkifyBareUrls(out);
  out = out.replace(/\u0000A(\d+)\u0000/g, (_m, idx) => anchors[Number(idx)]);
  // bold / italic / strike
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return out;
}

function matchListItem(line) {
  // bullets: - item / * item / + item ; numbered: 1. item
  const bullet = /^(\s*)([-*+])\s+(.*)$/.exec(line);
  if (bullet) return { kind: 'ul', content: bullet[3].trim() };
  const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
  if (numbered) return { kind: 'ol', content: numbered[3].trim() };
  return null;
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

function mdToHtml(source) {
  if (source == null) return '';
  const text = String(source).replace(/\r\n/g, '\n');

  // Pull fenced code blocks out so their content is never markdown-processed.
  const blocks = [];
  const withPlaceholders = text.replace(/```([\w+#.-]*)[ \t]*\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = blocks.length;
    blocks.push({ lang: lang || '', code: code.replace(/\n$/, '') });
    return `\u0000CODE${idx}\u0000`;
  });

  const lines = withPlaceholders.split('\n');
  const html = [];
  let paragraph = [];
  let inList = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(escapeHtml(paragraph.join('\n'))).replace(/\n/g, '<br>')}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (inList) {
      html.push(`</${inList}>`);
      inList = null;
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const line = rawLine.replace(/\s+$/, '');
    const placeholder = /^\u0000CODE(\d+)\u0000$/.exec(line.trim());
    if (placeholder) {
      flushParagraph();
      closeList();
      const block = blocks[Number(placeholder[1])];
      html.push(
        `<pre class="code" data-lang="${escapeHtml(block.lang)}"><div class="code-bar"><span>${escapeHtml(
          block.lang || 'code',
        )}</span><button class="copy-btn" type="button" data-copy>copy</button></div><code>${escapeHtml(
          block.code,
        )}</code></pre>`,
      );
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level} class="md-h">${inlineMarkdown(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[-*_\s]*$/.test(line)) {
      flushParagraph();
      closeList();
      html.push('<hr>');
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${inlineMarkdown(escapeHtml(quote[1]))}</blockquote>`);
      continue;
    }

    const item = matchListItem(line);
    if (item) {
      flushParagraph();
      if (inList !== item.kind) {
        closeList();
        html.push(`<${item.kind}>`);
        inList = item.kind;
      }
      html.push(`<li>${inlineMarkdown(escapeHtml(item.content))}</li>`);
      continue;
    }

    // GFM table: a header row followed by a |---|:--:| delimiter row
    if (isTableHeaderLine(line) && index + 1 < lines.length && isDelimiterRow(lines[index + 1])) {
      flushParagraph();
      closeList();
      const header = splitTableRow(line);
      const aligns = splitTableRow(lines[index + 1]).map(alignOf);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim() && isTableLine(lines[index].replace(/\s+$/, ''))) {
        if (/^\u0000CODE\d+\u0000$/.test(lines[index].trim())) break;
        rows.push(splitTableRow(lines[index].replace(/\s+$/, '')));
        index++;
      }
      index--; // the for-loop increments again
      const head = header.map((cell, i) => `<th${cellTag(aligns[i])}>${inlineMarkdown(escapeHtml(cell))}</th>`).join('');
      const body = rows
        .map((cells) => `<tr>${header.map((_h, i) => `<td${cellTag(aligns[i])}>${inlineMarkdown(escapeHtml(cells[i] == null ? '' : cells[i]))}</td>`).join('')}</tr>`)
        .join('');
      html.push(`<div class="table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  closeList();

  return html.join('\n');
}

window.mdToHtml = mdToHtml;
window.escapeHtml = escapeHtml;
window.linkify = linkify;
