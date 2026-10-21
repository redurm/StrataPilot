'use strict';

/*
 * D10 i18n helper: list what the app asks the catalogs for, and what is still missing.
 *
 *   node scripts/i18n-extract.js              summary per catalog (missing / unused)
 *   node scripts/i18n-extract.js --keys       every key, one per line (for eyeballing)
 *   node scripts/i18n-extract.js --missing    keys with no entry in some catalog
 *   node scripts/i18n-extract.js --unwrapped  a heuristic list of English UI strings that are NOT wrapped
 *
 * The keys are the English source strings themselves (see renderer/i18n.js), so a key is added by
 * writing tr('Some label') in the code - no id table to keep in sync. test/i18n.test.js runs this
 * extraction and fails when a wrapped string has no entry in zh-TW or zh-CN, which is what keeps a
 * new label from silently staying English for Chinese users.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCES = [
  // toast() translates its message centrally (#32), so a bare toast('saved') is a catalog key too:
  ['renderer/app.js', ['tr', 'i18nKey', 'toast', ['pushNote', 1]]],
  ['renderer/storage.js', ['tr', 'i18nKey', 'toast', ['pushNote', 1]]],
  ['renderer/tree.js', ['tr', 'i18nKey', 'toast', ['pushNote', 1]]],
  ['renderer/settings.js', ['tr', 'i18nKey', 'toast', ['pushNote', 1]]],
  ['renderer/modals.js', ['tr', 'i18nKey', 'toast', ['pushNote', 1]]],
  ['renderer/composer.js', ['tr', 'i18nKey', 'toast', ['pushNote', 1]]],
  ['renderer/transcript.js', ['tr', 'i18nKey', 'toast', ['pushNote', 1]]],
  ['renderer/monitor.js', ['tr', 'i18nKey', 'toast', ['pushNote', 1]]],
  ['main.js', ['tr']],
  // describeCron() builds the Jobs list text in lib/cron.js; without this the phrases it wraps in t() never reach
  // the catalogs, and the extractor cannot fail when one is missing
  // the scenarios are their own file now (#12); they call tr() for the labels they assert on, so
  // their keys must stay in the catalogs or the stale-entry test would drop them
  ['lib/cron.js', ['t']],
];
const HTML_FILE = 'renderer/index.html';
const CATALOGS = ['zh-TW', 'zh-CN'];

/** Read one file as UTF-8 (git may hand the working tree CRLF, which is fine). */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * Collect the string literals that make up the argument at `argIndex` (0 by default) of every `fn(`
 * call. Walking by hand instead of one big regex keeps `tr(cond ? 'one' : 'other', { n })` working -
 * both keys count. pushNote(tab, 'text') needs the second argument, because the first one is a tab.
 */
function wrappedKeys(source, fn, argIndex = 0) {
  const keys = new Set();
  const needle = `${fn}(`;
  let at = 0;
  for (;;) {
    at = source.indexOf(needle, at);
    if (at === -1) break;
    // skip things like `xtr(` or `openSimpleModal(` - the call must start at a word boundary
    const before = source[at - 1];
    if (before && /[A-Za-z0-9_.$]/.test(before)) {
      at += needle.length;
      continue;
    }
    let i = at + needle.length;
    let depth = 1;
    let skipped = 0;
    const first = [];
    let inString = null;
    let buf = '';
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (inString) {
        if (ch === '\\') {
          buf += ch + source[i + 1];
          i += 1;
          continue;
        }
        if (ch === inString) {
          // a template literal is consumed but never a key: it carries interpolation, so there is
          // nothing to look up in the catalog. Without this, #32's toast() scan turned every
          // `toast(\`...${x}...\`)` call into an impossible key.
          if (inString !== '`' && skipped === argIndex) first.push(buf);
          inString = null;
          continue;
        }
        if (ch === '\n') break; // unterminated: give up on this call
        buf += ch;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        inString = ch;
        buf = '';
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth -= 1;
        if (depth === 0) break;
      } else if (ch === ',' && depth === 1) {
        skipped += 1;
        if (skipped > argIndex) break; // the argument we wanted is behind us
      }
    }
    for (const raw of first) {
      const text = unescapeJs(raw);
      if (text && text.trim()) keys.add(text);
    }
    at += needle.length;
  }
  return keys;
}

/** Turn the escapes a source literal contains into the characters the UI will actually show. */
function unescapeJs(raw) {
  return raw.replace(/\\u\{([0-9a-fA-F]{2,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})|\\(.)/g, (whole, brace, four, hex, other) => {
    if (brace) return String.fromCodePoint(parseInt(brace, 16));
    if (four) return String.fromCharCode(parseInt(four, 16));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    if (other === 'n') return '\n';
    if (other === 't') return '\t';
    if (other === 'r') return '';
    return other;
  });
}

/** The static chrome: text nodes and the title / placeholder / aria-label attributes in index.html. */
function staticHtmlKeys(html) {
  const keys = new Set();
  for (const match of html.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1].replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013').replace(/&hellip;/g, '\u2026')
      .replace(/&middot;/g, '\u00b7').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    if (text && /[A-Za-z\u4e00-\u9fff]/.test(text)) keys.add(text);
  }
  for (const match of html.matchAll(/(?:title|placeholder|aria-label)="([^"]+)"/g)) {
    const text = match[1].replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013').replace(/&hellip;/g, '\u2026')
      .replace(/&middot;/g, '\u00b7').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    if (text) keys.add(text);
  }
  return keys;
}

/** Strings that look like UI text but are not wrapped - the stage-2 to-do list, not a hard gate. */
function unwrappedCandidates(source) {
  const out = [];
  const pattern = /(?:^|[\s(,:=])('([^'\n]{4,})'|"([^"\n]{4,})")/g;
  for (const match of source.matchAll(pattern)) {
    const text = match[2] || match[3];
    if (!text) continue;
    if (!/[A-Za-z]/.test(text)) continue;
    if (!/[a-z] [a-z]|[A-Z][a-z]|—|…/.test(text)) continue; // needs to read like a phrase
    if (/^[a-z0-9_\-./:#\\ ]+$/.test(text) && !/ /.test(text.trim())) continue;
    if (/[<>{}]|%s|node_modules|\.json|\.js|http|\/[a-z-]+\/[a-z-]+/.test(text)) continue;
    if (/^(usage|error|warn|info|debug|\[)/.test(text)) continue; // log prefixes
    out.push(text);
  }
  return out;
}

function collect() {
  const keys = new Set();
  for (const [rel, fns] of SOURCES) {
    const source = read(rel);
    for (const spec of fns) {
      const [fn, argIndex = 0] = Array.isArray(spec) ? spec : [spec, 0];
      for (const key of wrappedKeys(source, fn, argIndex)) keys.add(key);
    }
  }
  for (const key of staticHtmlKeys(read(HTML_FILE))) keys.add(key);
  return keys;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const keys = [...collect()].sort();
  const catalogs = new Map(CATALOGS.map((lang) => [lang, JSON.parse(read(`locales/${lang}.json`))]));

  if (args.has('--keys')) {
    // one key per line, newlines escaped, so the list can be read back line by line
    console.log(keys.map((key) => key.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')).join('\n'));
    return;
  }

  const missing = new Map(CATALOGS.map((lang) => [lang, keys.filter((key) => !catalogs.get(lang)[key])]));
  const unused = new Map(CATALOGS.map((lang) => [lang, Object.keys(catalogs.get(lang)).filter((key) => !keys.includes(key))]));

  if (args.has('--missing')) {
    for (const lang of CATALOGS) {
      for (const key of missing.get(lang)) console.log(`${lang}\t${key.replace(/\n/g, '\\n')}`);
    }
    return;
  }

  if (args.has('--unwrapped')) {
    const wrapped = keys;
    for (const [rel] of SOURCES) {
      const seen = new Set();
      for (const text of unwrappedCandidates(read(rel))) {
        if (seen.has(text) || wrapped.includes(text)) continue;
        seen.add(text);
        console.log(`${rel}\t${text}`);
      }
    }
    return;
  }

  console.log(`keys used by the code: ${keys.length}`);
  for (const lang of CATALOGS) {
    const entries = Object.keys(catalogs.get(lang)).length;
    console.log(`${lang}: entries=${entries} missing=${missing.get(lang).length} unused=${unused.get(lang).length}`);
    for (const key of missing.get(lang).slice(0, 40)) console.log(`   missing  ${key.replace(/\n/g, '\\n').slice(0, 110)}`);
    for (const key of unused.get(lang).slice(0, 10)) console.log(`   unused   ${key.replace(/\n/g, '\\n').slice(0, 110)}`);
  }
}

if (require.main === module) main();

// #28: wrappedKeys / staticHtmlKeys / unescapeJs are helpers of collect(); test/i18n.test.js needs
// collect and CATALOGS, and exporting the rest only widens the surface
module.exports = { collect, CATALOGS };
