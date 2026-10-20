'use strict';

/**
 * One-shot diagnostics report ("Copy diagnostics").
 *
 * docs/TROUBLESHOOTING.md "What to include when reporting an issue" asks the reporter for
 * five things they had to collect by hand (log tail, smoke-rpc header, pi/Strata versions,
 * /health, both model configs, a queue screenshot). This module assembles all of them that
 * are machine-readable into one pasteable block.
 *
 * Layout:
 * - collect(): reads files / takes already-fetched network results, returns a plain object
 * - format(): turns that object into the text block
 * - redact(): drops anything that looks like a key before it reaches the clipboard
 *
 * format() and redact() are pure so test/diagnostics.test.js can assert on them without
 * Electron, pi or Strata.
 */

const fs = require('node:fs');
const path = require('node:path');

// Keys whose value must never leave the machine, whatever file it came from.
const SECRET_KEY_RE = /(api[_-]?key|apikey|authorization|bearer|token|secret|password|passwd|credential|cookie)/i;
// ...unless the key is metadata ABOUT such a field ("token_type": "Bearer" is not a secret). The list
// is deliberately narrow: `name`/`names` and `header`/`headers` used to be in it, and that let
// `authorization_header`, `api_key_name` and `password_name` through verbatim - a key named `*_header`
// holding a literal credential is the realistic case here. The module's own rule is "a false positive
// costs nothing, a leaked key costs a credential rotation", so the exception list follows it.
const METADATA_KEY_RE = /(?:^|[_\-$.])(type|kind|class|count|num|number|enabled|available|supported|list|mode|modes|algorithm|algorithms|param|params)$/i;
const REDACTED = '***redacted***';

/**
 * Credential shapes that appear in free text, where the key name gives nothing away: a token pasted
 * into a log line, a `models.json` value under a harmless-looking key, a JWT in a /health body.
 * Blunt on purpose - see the comment on METADATA_KEY_RE.
 */
const SECRET_VALUE_RES = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, 'openai-style key (sk-…)'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]+/g, 'Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, 'Google API key'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AWS access key id'],
  [/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)+/g, 'JWT'],
];

/** True when a key name means its value must be dropped. */
function isSecretKey(key) {
  const name = String(key || '');
  // secret first, metadata second: the old order let the metadata exception win whenever the key
  // merely ENDED in one of its words, which is how `authorization_header` was treated as metadata
  if (!SECRET_KEY_RE.test(name)) return false;
  return !METADATA_KEY_RE.test(name);
}

/** Replace credential-shaped substrings anywhere inside a piece of text. */
function scrubValue(text) {
  let out = String(text == null ? '' : text);
  for (const [pattern] of SECRET_VALUE_RES) out = out.replace(pattern, REDACTED);
  return out;
}

/** Replace obvious secrets anywhere inside a parsed JSON value (arrays/objects recursed). */
function redact(value, depth = 0) {
  if (depth > 12 || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSecretKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    // a credential can also sit under a harmless-looking key (`{"note": "sk-..."}`), so the shapes
    // are scrubbed from every string leaf, not only from the free-text sections of the report
    out[key] = typeof item === 'string' ? scrubValue(item) : redact(item, depth + 1);
  }
  return out;
}

/** Redact a raw JSON text blob; falls back to a line filter when the file is not valid JSON. */
function redactText(text) {
  const raw = String(text == null ? '' : text);
  try {
    return JSON.stringify(redact(JSON.parse(raw)), null, 2);
  } catch {
    return raw
      .split('\n')
      .filter((line) => !SECRET_KEY_RE.test(line))
      .map(scrubInline) // a bare token on a line that names no key still has to go
      .join('\n');
  }
}

/**
 * Scrub secrets out of free text (log lines, /health bodies): keys can appear inline there,
 * and pi's stderr sometimes echoes a config fragment. Deliberately blunt — a false positive
 * in a diagnostics report costs nothing, a leaked key costs a credential rotation.
 *
 * The old version only knew the `Bearer …` and `key = value` shapes, so a bare token in free text
 * (`model loaded with key sk-…`, `jwt eyJ…`) went through untouched.
 */
function scrubInline(text) {
  return scrubValue(
    String(text == null ? '' : text)
      .replace(/\bbearer\s+[A-Za-z0-9._\-/+=]+/gi, 'Bearer ***')
      .replace(/("(?:api[_-]?key|apikey|access[_-]?token|secret|password|passwd|client[_-]?secret)"\s*:\s*")[^"]*(")/gi, '$1***$2')
      .replace(/\b(api[_-]?key|apikey|access[_-]?token|secret|password|passwd)(\s*[=:]\s*|\s+)(\S+)/gi, '$1$2***'),
  );
}

/** Read + redact a JSON config file; never throws (missing file becomes a one-line note). */
function readConfig(filePath) {
  const label = String(filePath || '');
  if (!label) return { path: label, ok: false, error: 'path not resolved' };
  let raw;
  try {
    const stat = fs.statSync(label);
    if (stat.isDirectory()) return { path: label, ok: false, error: 'is a directory' };
    raw = fs.readFileSync(label, 'utf8');
  } catch (err) {
    return { path: label, ok: false, error: err.message };
  }
  if (!raw.trim()) return { path: label, ok: false, error: 'file is empty' };
  try {
    return { path: label, ok: true, sizeBytes: Buffer.byteLength(raw), data: redact(JSON.parse(raw)) };
  } catch (err) {
    // A config file that is half-written (pi killed mid-save, disk full) is exactly the state a user
    // is reporting, and the old code answered with `error: Unexpected end of JSON input` and dropped
    // the content - the report went blind on the one case where it mattered. `redactText()` had no
    // production call site at all (#13): this is it, and it is the right shape for it, because it
    // handles both "is JSON" and "is not JSON" without throwing.
    return { path: label, ok: true, sizeBytes: Buffer.byteLength(raw), text: redactText(raw), parseError: err.message };
  }
}

/**
 * Tail of a text file (the log): read the last `maxBytes` and keep the last `maxLines`
 * complete lines. Reading from the end matters — the log rotates at ~2 MB and only the
 * tail is interesting.
 */
function tail(filePath, { maxBytes = 64 * 1024, maxLines = 150 } = {}) {
  const label = String(filePath || '');
  if (!label) return { path: label, lines: [], note: 'log file not initialised' };
  let fd;
  try {
    const stat = fs.statSync(label);
    fd = fs.openSync(label, 'r');
    const size = stat.size;
    const want = Math.min(size, maxBytes);
    const buf = Buffer.alloc(want);
    fs.readSync(fd, buf, 0, want, Math.max(0, size - want));
    const text = buf.toString('utf8');
    const all = text.split('\n').map((entry) => entry.replace(/\r$/, '')).filter((entry) => entry.trim());
    // the read window may start mid-line: drop that partial head unless the whole file was read
    const droppedFirst = size > want && all.length > 0;
    const kept = (droppedFirst ? all.slice(1) : all).slice(-maxLines);
    return {
      path: label,
      lines: kept,
      note: size > want ? `showing last ${kept.length} of the ~${Math.round(want / 1024)} KB read (file is ${size} bytes)` : '',
    };
  } catch (err) {
    return { path: label, lines: [], note: `could not read log: ${err.message}` };
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

function line(key, value) {
  const text = value == null || value === '' ? '(not reported)' : String(value);
  return `${String(key).padEnd(18)} ${text}`;
}

function jsonBlock(value) {
  if (value == null) return '  (none)';
  // belt and braces: collect() already redacts, but a report that reaches a bug tracker must
  // never carry a key even if a new call site forgets to
  if (value.ok) {
    const body = typeof value.text === 'string' ? redactText(value.text) : JSON.stringify(redact(value.data), null, 2);
    const note = value.parseError ? ` (not valid JSON: ${value.parseError})` : '';
    return `  ${value.path}${note}\n${body.replace(/^/gm, '  ')}`;
  }
  return `  ${value.path}: ${value.error}`;
}

/**
 * Build the report. `data` is gathered by main.js (it owns app paths, the Strata fetch and
 * the renderer's queue snapshot); everything here is formatting plus the two config reads.
 */
function format(data = {}) {
  const out = [];
  out.push('StrataPilot — diagnostics');
  out.push(`generated: ${new Date().toISOString()}`);
  out.push('');

  out.push('[1] symptom / reproduction steps');
  out.push('  (fill in: which tab, what you pressed, what happened instead)');
  out.push('');

  out.push('[2] app / runtime');
  out.push(line('app version', data.app && data.app.appVersion));
  out.push(line('electron', data.app && data.app.electronVersion));
  out.push(line('node', data.app && data.app.nodeVersion));
  out.push(line('platform', data.app && data.app.platform));
  out.push(line('log file', data.app && data.app.logPath));
  out.push(line('settings file', data.app && data.app.settingsPath));
  out.push(line('sessions root', data.app && data.app.sessionsRoot));
  out.push(line('default cwd', data.app && data.app.defaultCwd));
  // D9: the token ledger is what a "the numbers are wrong" report is about, so it goes in the report
  // rather than being asked for in a follow-up question
  const usage = data.usage;
  if (usage && usage.all) {
    const n = (value) => Number(value || 0).toLocaleString('en-US');
    out.push(
      line(
        'token ledger',
        `${n(usage.all.total)} tokens (in ${n(usage.all.in)} / out ${n(usage.all.out)} / cache read ${n(usage.all.cacheRead)} / cache write ${n(usage.all.cacheWrite)}) from ${usage.entries} session file(s) over ${usage.dayCount} session-days`,
      ),
    );
    out.push(line('ledger calls', `${n(usage.all.answers)} model replies, ${n(usage.all.compactions)} compaction summaries, ${n(usage.all.branches)} branch summaries`));
    out.push(line('ledger file', usage.ledgerFile));
    const flags = [];
    if (usage.gone) flags.push(`${usage.gone} session file(s) already deleted (history kept)`);
    if (usage.truncated) flags.push(`${usage.truncated} session(s) past the 12 MB scan cap, counted only up to it`);
    if (usage.dedupeMissed) flags.push(`${usage.dedupeMissed} fork(s) not deduplicated (parent session file gone)`);
    if (flags.length) out.push(line('ledger notes', flags.join('; ')));
    // the rates live in the settings file, not in the ledger (the ledger stores only token counts), so
    // a "the money looks wrong" report has to carry them too
    const rateFields = ['in', 'out', 'cacheRead', 'cacheWrite'];
    const rateLabels = { in: 'in', out: 'out', cacheRead: 'cache read', cacheWrite: 'cache write' };
    const hasRate = (row) => !!row && rateFields.some((key) => (Number(row[key]) || 0) > 0);
    const rateRow = (row) => rateFields.map((key) => `${rateLabels[key]} ${Number(row && row[key]) || 0}`).join(' / ');
    const rates = data.usageRates || {};
    const modelRows = Object.entries(rates.byModel || {}).filter(([, row]) => hasRate(row));
    if (hasRate(rates.default) || modelRows.length) {
      out.push(line('ledger rates', `USD per 1,000,000 tokens - default: ${rateRow(rates.default)}`));
      if (modelRows.length) out.push(line('rate rows', modelRows.map(([model, row]) => `${model}: ${rateRow(row)}`).join('; ')));
    } else {
      out.push(line('ledger rates', 'no rates entered (the rate table in the Usage dialog) - Strata reports no prices, so the money side reads $0'));
    }
  }
  out.push('');

  out.push('[3] pi install (same four lines as `node test/smoke-rpc.js`)');
  out.push(line('cli', data.pi && data.pi.cliPath));
  out.push(line('node runtime', data.pi && data.pi.nodePath));
  out.push(line('pi version', data.pi && data.pi.piVersion));
  out.push(line('tested against', data.pi && data.pi.testedVersion));
  out.push(line('sessions root', data.pi && data.pi.sessionsRoot));
  out.push(line('runAsNode', data.pi && data.pi.runAsNode));
  out.push(line('pi settings', data.pi && data.pi.settingsFile));
  out.push(jsonBlock(data.pi && data.pi.defaultModel));
  out.push('');

  out.push('[4] strata server');
  out.push(line('base url', data.strata && data.strata.baseUrl));
  out.push(line('health', scrubInline(data.strata && data.strata.healthText)));
  out.push(line('models', scrubInline(data.strata && data.strata.modelsText)));
  out.push(line('metrics url', data.strata && data.strata.metricsUrl));
  out.push(jsonBlock(data.strata && data.strata.engineConfig));
  out.push('');

  out.push('[5] model configuration (pi side, key redacted)');
  out.push(jsonBlock(data.pi && data.pi.modelsJson));
  out.push('');

  out.push('[6] open sessions / queue');
  out.push(line('serial queue', data.queue && data.queue.serial));
  out.push(line('active tab', data.queue && data.queue.active));
  for (const row of (data.queue && data.queue.rows) || []) {
    out.push(`  ${row.label}  [${row.state}] cwd=${row.cwd || '(none)'} session=${row.sessionPath || 'unsaved'} outbox=${row.outbox} model=${row.model || '?'}`);
  }
  if (!((data.queue && data.queue.rows) || []).length) out.push('  (no open tabs reported)');
  out.push('');

  out.push(`[7] log tail (${(data.log && data.log.path) || 'n/a'})`);
  if (data.log && data.log.note) out.push(`  ${data.log.note}`);
  for (const entry of (data.log && data.log.lines) || []) out.push(`  ${scrubInline(entry)}`);
  out.push('');

  out.push('Keys are redacted; still check the pasted text before attaching it to a report.');
  return out.join('\n');
}

module.exports = {
  SECRET_KEY_RE,
  SECRET_VALUE_RES,
  REDACTED,
  isSecretKey,
  redact,
  redactText,
  scrubValue,
  scrubInline,
  readConfig,
  tail,
  format,
};
