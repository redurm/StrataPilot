'use strict';

/**
 * D9: the token usage ledger.
 *
 * pi already writes the usage of every assistant message (input / output / cacheRead / cacheWrite /
 * cost) into the session JSONL, but those numbers only live as long as the file does: the sidebar
 * chip reads them per session, and a D7 cleanup deletes the file - and with it the history of what
 * that session cost. Nothing else adds up "what did this week cost".
 *
 * So this module keeps its own rollup in `userData/token_usage.json`: one entry per session file,
 * each holding day buckets of in / out / cacheRead / cacheWrite / cost / messages, split per model.
 * `series()` then folds those day buckets into day / week / month / year columns for the chart.
 *
 * Three things are deliberate:
 *
 *  - Entries are keyed by the session FILE NAME, not its path. pi names a session file
 *    `<createdAt>Z_<uuid>.jsonl`, so the name survives a folder-group rename (which is exactly what
 *    the pi-on-strata -> StrataPilot rename did to every session on this machine) while the path
 *    does not. A moved file updates `path` and keeps its history instead of double counting.
 *  - An entry whose file disappeared is marked `gone` and kept: deleting a session file must not
 *    erase the record of what it cost. `recount()` is the explicit way to drop those.
 *  - The scan is incremental with the same (mtimeMs, size) stamp trick as B3: a session file is
 *    append-only, so an unchanged file is never opened again. That is what makes it affordable to
 *    answer a chart request from a folder of thousands of sessions.
 */

const fs = require('node:fs');
const path = require('node:path');

const { sessionsRoot, iterSessionFiles, forEachLine, MAX_SCAN_BYTES } = require('./sessions');

const LEDGER_VERSION = 1;
/** Day buckets older than this are dropped on the next refresh (the chart never asks for them). */
const RETENTION_DAYS = 3 * 365;
/** At most this many model keys in one day bucket, the `other` catch-all included. */
const MAX_MODELS_PER_DAY = 16;
const OTHER_MODEL = 'other';
const UNKNOWN_MODEL = 'unknown';
/** Guard against a runaway chart: a range wider than this many buckets is clamped. */
const MAX_BUCKETS = 800;

/** Absolute path of the ledger file; set once by main.js (tests point it at a temp dir). */
let ledgerFile = null;
/** Parsed ledger, or null when it has to be read again from `ledgerFile`. */
let ledger = null;
let dirty = false;

function setLedgerFile(file) {
  ledgerFile = file ? path.resolve(file) : null;
  ledger = null;
  dirty = false;
}

function getLedgerFile() {
  return ledgerFile;
}

function blank() {
  return { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, msgs: 0 };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Local calendar day of a timestamp ("YYYY-MM-DD"). Local, not UTC: a day/week/month/year chart is
 * a question about the user's calendar, and a session that ran at 23:30 belongs to their day even
 * though pi stamps it in UTC.
 */
function dayKeyOf(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Monday-start week key (the app is zh-TW, where the week starts on Monday). */
function weekStartKey(dayKey) {
  const [year, month, day] = String(dayKey).split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dayKeyOf(date);
}

/** Bucket key for a day key at the requested granularity. */
function bucketKey(dayKey, unit) {
  if (unit === 'week') return weekStartKey(dayKey);
  if (unit === 'month') return String(dayKey).slice(0, 7);
  if (unit === 'year') return String(dayKey).slice(0, 4);
  return String(dayKey);
}

/** Short axis label; `full` is the longer form for the tooltip / details line. */
function bucketLabel(key, unit) {
  if (unit === 'month') return key; // YYYY-MM
  if (unit === 'year') return key; // YYYY
  const [, month, day] = String(key).split('-');
  return `${month}/${day}`;
}

function bucketSpanMs(key, unit) {
  const [year, month, day] = String(key).split('-').map(Number);
  if (unit === 'year') return [new Date(year, 0, 1, 0, 0, 0, 0).getTime(), new Date(year, 11, 31, 23, 59, 59, 999).getTime()];
  if (unit === 'month') return [new Date(year, month - 1, 1, 0, 0, 0, 0).getTime(), new Date(year, month, 0, 23, 59, 59, 999).getTime()];
  if (unit === 'week') {
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day + 6, 23, 59, 59, 999);
    return [start.getTime(), end.getTime()];
  }
  return [new Date(year, month - 1, day, 0, 0, 0, 0).getTime(), new Date(year, month - 1, day, 23, 59, 59, 999).getTime()];
}

function addUsage(bucket, usage) {
  if (!usage) return false;
  const input = usage.input || 0;
  const output = usage.output || 0;
  const cacheRead = usage.cacheRead || 0;
  const cacheWrite = usage.cacheWrite || 0;
  const cost = (usage.cost && usage.cost.total) || 0;
  const total = usage.totalTokens != null ? usage.totalTokens : input + output + cacheRead + cacheWrite;
  if (!input && !output && !cacheRead && !cacheWrite && !total && !cost) return false;
  bucket.in += input;
  bucket.out += output;
  bucket.cacheRead += cacheRead;
  bucket.cacheWrite += cacheWrite;
  bucket.total += total;
  bucket.cost += cost;
  bucket.msgs += 1;
  return true;
}

/**
 * Read one session file and return its day buckets.
 *
 * Usage lives on assistant `message` entries (pi also has standalone `usage` entries, kept for
 * older logs). A record is dated by its own entry timestamp; when an entry has none, the session's
 * first timestamp is used, and failing that the file's mtime - a bucket is better than a dropped
 * record, and the `truncated` / `undated` flags say when a guess was made.
 */
function scanFile(filePath, stat) {
  const days = new Map(); // dayKey -> { totals, models: Map }
  let firstTs = '';
  let undated = 0;
  let currentModel = '';

  const touch = (dayKey) => {
    let day = days.get(dayKey);
    if (!day) {
      day = { totals: blank(), models: new Map() };
      days.set(dayKey, day);
    }
    return day;
  };

  /** Bucket for one model of one day; past the cap everything lands in `other`. */
  const modelBucket = (day, model) => {
    const key = model || UNKNOWN_MODEL;
    const existing = day.models.get(key);
    if (existing) return existing;
    if (day.models.size >= MAX_MODELS_PER_DAY - 1) {
      // deliberately NOT registered under `key`: a second key pointing at the same bucket object
      // would make the model list count the overflow twice
      if (!day.models.has(OTHER_MODEL)) day.models.set(OTHER_MODEL, blank());
      return day.models.get(OTHER_MODEL);
    }
    const created = blank();
    day.models.set(key, created);
    return created;
  };

  const record = (entry, usage) => {
    const ts = typeof entry.timestamp === 'string' ? entry.timestamp : '';
    const dayKey = dayKeyOf(ts || firstTs || stat.mtimeMs);
    if (!dayKey) return;
    if (!ts) undated += 1;
    const day = touch(dayKey);
    addUsage(day.totals, usage);
    addUsage(modelBucket(day, currentModel), usage);
  };

  forEachLine(filePath, (line) => {
    if (line[0] !== '{') return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    const ts = typeof entry.timestamp === 'string' ? entry.timestamp : '';
    if (ts && !firstTs) firstTs = ts;

    if (entry.type === 'model_change') {
      if (entry.modelId) currentModel = entry.modelId;
      return;
    }
    if (entry.type === 'usage') {
      record(entry, entry.usage);
      return;
    }
    if (entry.type !== 'message') return;
    const message = entry.message;
    if (!message) return;
    if (message.model) currentModel = message.model;
    if (message.role !== 'assistant' || !message.usage) return;
    record(entry, message.usage);
  });

  const out = {};
  for (const [dayKey, day] of days) {
    const models = {};
    for (const [model, bucket] of day.models) models[model] = bucket;
    out[dayKey] = { ...day.totals, models };
  }
  return { days: out, undated, truncated: stat.size > MAX_SCAN_BYTES };
}

function load() {
  if (ledger) return ledger;
  ledger = { version: LEDGER_VERSION, updatedAt: '', entries: {} };
  if (!ledgerFile) return ledger;
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    if (parsed && parsed.version === LEDGER_VERSION && parsed.entries && typeof parsed.entries === 'object') {
      ledger = { version: LEDGER_VERSION, updatedAt: parsed.updatedAt || '', entries: parsed.entries };
      for (const entry of Object.values(ledger.entries)) {
        if (!entry || typeof entry !== 'object') continue;
        if (!entry.days || typeof entry.days !== 'object') entry.days = {};
      }
    }
  } catch {
    // no ledger yet (or an unreadable one): the next refresh rebuilds it from the session files
  }
  return ledger;
}

function flush() {
  if (!ledgerFile || !ledger || !dirty) return false;
  const dir = path.dirname(ledgerFile);
  const tmp = `${ledgerFile}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    ledger.updatedAt = new Date().toISOString();
    fs.writeFileSync(tmp, JSON.stringify(ledger));
    fs.renameSync(tmp, ledgerFile); // atomic: a crash mid-write leaves the previous ledger intact
    dirty = false;
    return true;
  } catch (err) {
    console.error(`[usage-ledger] save failed: ${err.message}`);
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    return false;
  }
}

/** Drop day buckets outside the retention window, and entries that no longer have any. */
function prune(nowMs = Date.now()) {
  const cutoff = dayKeyOf(new Date(nowMs - RETENTION_DAYS * 86400000));
  let droppedDays = 0;
  let droppedEntries = 0;
  for (const [name, entry] of Object.entries(ledger.entries)) {
    for (const dayKey of Object.keys(entry.days)) {
      if (dayKey < cutoff) {
        delete entry.days[dayKey];
        droppedDays += 1;
      }
    }
    if (!Object.keys(entry.days).length && entry.gone) {
      delete ledger.entries[name];
      droppedEntries += 1;
    }
  }
  if (droppedDays || droppedEntries) dirty = true;
  return { droppedDays, droppedEntries };
}

/**
 * Bring the ledger up to date with the session files on disk. Unchanged files (same mtime + size)
 * are not opened at all, so this is cheap enough to run when a chart is asked for.
 */
function refresh({ force = false, nowMs = Date.now() } = {}) {
  const current = load();
  const root = sessionsRoot();
  const files = iterSessionFiles(root);
  const seen = new Set();
  let parsed = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const name = path.basename(file);
    seen.add(name);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue; // deleted between the listing and the stat
    }
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    let entry = current.entries[name];
    if (entry && entry.stamp === stamp && !force) {
      entry.path = file;
      entry.gone = false;
      skipped += 1;
      continue;
    }
    try {
      const scanned = scanFile(file, stat);
      if (!entry) {
        entry = { name, days: {} };
        current.entries[name] = entry;
      }
      entry.path = file;
      entry.stamp = stamp;
      entry.gone = false;
      entry.lastSeenMs = nowMs;
      entry.undated = scanned.undated;
      entry.truncated = scanned.truncated;
      entry.days = scanned.days; // replace wholesale: the file is the source of truth
      parsed += 1;
      dirty = true;
    } catch (err) {
      failed += 1;
      console.error(`[usage-ledger] scan failed for ${file}: ${err.message}`);
    }
  }

  for (const [name, entry] of Object.entries(current.entries)) {
    if (!seen.has(name) && !entry.gone) {
      entry.gone = true; // file deleted (D7 cleanup) or moved out of the sessions root
      dirty = true;
    }
  }

  prune(nowMs);
  flush();
  return {
    root,
    ledgerFile,
    parsed,
    skipped,
    failed,
    entries: Object.keys(current.entries).length,
    gone: Object.values(current.entries).filter((entry) => entry.gone).length,
    truncated: Object.values(current.entries).filter((entry) => entry.truncated).length,
  };
}

/** Throw the rollup away and rebuild it from the files that exist right now. */
function recount() {
  const current = load();
  let dropped = 0;
  for (const [name, entry] of Object.entries(current.entries)) {
    if (entry.gone) {
      delete current.entries[name];
      dropped += 1;
    }
  }
  dirty = true;
  const result = refresh({ force: true });
  result.droppedGone = dropped;
  return result;
}

function resetLedger() {
  ledger = null;
  dirty = false;
}

/**
 * Fold day buckets into the requested granularity.
 *
 * `unit`: day | week | month | year. `fromMs` / `toMs` bound the range (inclusive, local calendar).
 * `limit` keeps the newest N buckets (after filling). `fill` inserts empty buckets for periods with
 * no usage, so the chart's x axis is a real time axis instead of a list of the days that happened
 * to have traffic.
 */
function series({ unit = 'day', fromMs = null, toMs = null, limit = 0, fill = true } = {}) {
  const current = load();
  const kind = ['day', 'week', 'month', 'year'].includes(unit) ? unit : 'day';
  const fromKey = Number.isFinite(fromMs) ? bucketKey(dayKeyOf(new Date(fromMs)), 'day') : '';
  const toKey = Number.isFinite(toMs) ? bucketKey(dayKeyOf(new Date(toMs)), 'day') : '';

  const buckets = new Map();
  const sessionsPerBucket = new Map();
  let dayCount = 0;

  const touch = (key) => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, ...blank(), models: new Map() };
      buckets.set(key, bucket);
      sessionsPerBucket.set(key, new Set());
    }
    return bucket;
  };

  for (const [name, entry] of Object.entries(current.entries)) {
    for (const [dayKey, day] of Object.entries(entry.days || {})) {
      if (fromKey && dayKey < fromKey) continue;
      if (toKey && dayKey > toKey) continue;
      dayCount += 1;
      const key = bucketKey(dayKey, kind);
      const bucket = touch(key);
      bucket.in += day.in || 0;
      bucket.out += day.out || 0;
      bucket.cacheRead += day.cacheRead || 0;
      bucket.cacheWrite += day.cacheWrite || 0;
      bucket.total += day.total || 0;
      bucket.cost += day.cost || 0;
      bucket.msgs += day.msgs || 0;
      sessionsPerBucket.get(key).add(name);
      for (const [model, modelBucket] of Object.entries(day.models || {})) {
        const target = bucket.models.get(model) || (() => {
          const created = blank();
          bucket.models.set(model, created);
          return created;
        })();
        target.in += modelBucket.in || 0;
        target.out += modelBucket.out || 0;
        target.cacheRead += modelBucket.cacheRead || 0;
        target.cacheWrite += modelBucket.cacheWrite || 0;
        target.total += modelBucket.total || 0;
        target.cost += modelBucket.cost || 0;
        target.msgs += modelBucket.msgs || 0;
      }
    }
  }

  let keys = [...buckets.keys()].sort();
  if (fill && keys.length) {
    keys = fillGaps(keys, kind);
  }
  if (limit > 0 && keys.length > limit) keys = keys.slice(keys.length - limit);

  const out = keys.map((key) => {
    const bucket = buckets.get(key) || { key, ...blank(), models: new Map() };
    const [startMs, endMs] = bucketSpanMs(key, kind);
    const models = [...bucket.models.entries()]
      .map(([model, value]) => ({ model, ...value }))
      .sort((a, b) => b.total - a.total);
    return {
      key,
      label: bucketLabel(key, kind),
      full: kind === 'week' ? `week of ${key}` : kind === 'day' ? key : key,
      startMs,
      endMs,
      in: bucket.in,
      out: bucket.out,
      cacheRead: bucket.cacheRead,
      cacheWrite: bucket.cacheWrite,
      total: bucket.total,
      cost: bucket.cost,
      msgs: bucket.msgs,
      sessions: sessionsPerBucket.has(key) ? sessionsPerBucket.get(key).size : 0,
      models,
    };
  });

  const totals = out.reduce((sum, bucket) => {
    sum.in += bucket.in;
    sum.out += bucket.out;
    sum.cacheRead += bucket.cacheRead;
    sum.cacheWrite += bucket.cacheWrite;
    sum.total += bucket.total;
    sum.cost += bucket.cost;
    sum.msgs += bucket.msgs;
    return sum;
  }, blank());

  const modelTotals = new Map();
  for (const bucket of out) {
    for (const model of bucket.models) {
      const target = modelTotals.get(model.model) || { model: model.model, ...blank() };
      target.in += model.in;
      target.out += model.out;
      target.cacheRead += model.cacheRead;
      target.cacheWrite += model.cacheWrite;
      target.total += model.total;
      target.cost += model.cost;
      target.msgs += model.msgs;
      modelTotals.set(model.model, target);
    }
  }

  return {
    unit: kind,
    buckets: out,
    totals,
    models: [...modelTotals.values()].sort((a, b) => b.total - a.total),
    dayCount,
    entries: Object.keys(current.entries).length,
    gone: Object.values(current.entries).filter((entry) => entry.gone).length,
    truncated: Object.values(current.entries).filter((entry) => entry.truncated).length,
    ledgerFile,
    retentionDays: RETENTION_DAYS,
  };
}

/** Insert the periods that have no data between the first and the last bucket. */
function fillGaps(keys, unit) {
  if (keys.length < 2) return keys;
  const out = [keys[0]];
  for (let i = 1; i < keys.length; i += 1) {
    let cursor = keys[i - 1];
    const target = keys[i];
    let guard = 0;
    while (cursor !== target && guard < MAX_BUCKETS) {
      cursor = nextKey(cursor, unit);
      if (!cursor) break;
      if (cursor === target) break;
      out.push(cursor);
      guard += 1;
    }
    out.push(target);
    if (out.length > MAX_BUCKETS) return out.slice(out.length - MAX_BUCKETS);
  }
  return out;
}

function nextKey(key, unit) {
  const [year, month, day] = String(key).split('-').map(Number);
  if (!year) return '';
  if (unit === 'year') return String(year + 1);
  if (unit === 'month') return month === 12 ? `${year + 1}-01` : `${year}-${pad2(month + 1)}`;
  const date = new Date(year, month - 1, day + (unit === 'week' ? 7 : 1), 12);
  return dayKeyOf(date);
}

/**
 * Small summary for the sidebar footer and the dialog header: all-time totals plus the last 30 days.
 * Cheap - it walks the rollup, never the session files.
 */
function summary({ nowMs = Date.now() } = {}) {
  const all = series({ unit: 'year', fill: false });
  const month = series({ unit: 'day', fromMs: nowMs - 30 * 86400000, toMs: nowMs, fill: false });
  const week = series({ unit: 'day', fromMs: nowMs - 7 * 86400000, toMs: nowMs, fill: false });
  return {
    all: all.totals,
    last30: month.totals,
    last7: week.totals,
    entries: all.entries,
    gone: all.gone,
    truncated: all.truncated,
    dayCount: all.dayCount,
    ledgerFile,
    retentionDays: RETENTION_DAYS,
  };
}

module.exports = {
  LEDGER_VERSION,
  RETENTION_DAYS,
  MAX_MODELS_PER_DAY,
  OTHER_MODEL,
  UNKNOWN_MODEL,
  setLedgerFile,
  getLedgerFile,
  resetLedger,
  refresh,
  recount,
  series,
  summary,
  flush,
  scanFile,
  dayKeyOf,
  bucketKey,
  bucketSpanMs,
  weekStartKey,
};
