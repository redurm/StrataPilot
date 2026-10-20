'use strict';

/**
 * D9: the token usage ledger.
 *
 * pi already writes the usage of every model call into the session JSONL, but those numbers only
 * live as long as the file does: the sidebar chip reads them per session, and a D7 cleanup deletes
 * the file - and with it the history of what that session cost. Nothing else adds up "what did this
 * week cost".
 *
 * This module keeps its own rollup in `userData/token_usage.json`: one entry per session file, each
 * holding day buckets of in / out / cacheRead / cacheWrite / cost / calls, split per model.
 * `series()` then folds those day buckets into day / week / month / year columns for the chart.
 *
 * The rule this module exists for: **tokens are never written off**. Nothing - compact, branch
 * switch, fork, cleanup, a session file being rewritten, a folder-group rename, an app restart - may
 * reduce what has already been recorded. Four mechanisms make that true:
 *
 *  1. Every usage-bearing entry is counted, not just assistant messages. pi stamps usage on four
 *     entry types (`message` of a model reply, `usage`, `compaction`, `branch_summary`), and the two
 *     summary ones are real model calls: a compaction here cost 72,124 tokens on its own. Counting
 *     only replies would silently drop the price of compacting.
 *  2. Day buckets are only ever ADDED to. A re-scan never replaces an entry's buckets, so a session
 *     file being rewritten (`SessionManager._rewriteFile()` opens it with "w") or truncated cannot
 *     subtract what was already banked. A watermark (`countedCount` + `lastRecordId`) makes sure the
 *     re-scan only adds what it has not seen yet, so it cannot double count either.
 *  3. Forks and clones are deduplicated by entry id. pi's fork/clone copies the parent's entries
 *     verbatim - ids included - into a new file, so a naive scan counts the same tokens twice. The
 *     first time a file with `parentSession` is seen, the ancestor chain is read and its entry ids
 *     are skipped.
 *  4. Entries are keyed by the session FILE NAME (`<createdAt>Z_<uuid>.jsonl`), not its path, so a
 *     folder-group rename - which is exactly what the pi-on-strata -> StrataPilot rename did to every
 *     session on this machine - moves the history instead of orphaning and duplicating it. An entry
 *     whose file disappeared is marked `gone` and kept: deleting a session file must not erase what
 *     it cost. `recount()` is the explicit, user-initiated way to make the chart match the disk.
 *
 * The scan is incremental with the same (mtimeMs, size) stamp trick as B3: a session file is
 * append-only in normal operation, so an unchanged file is never opened again. That is what makes it
 * affordable to answer a chart request from a folder of thousands of sessions.
 */

const fs = require('node:fs');
const path = require('node:path');

const { sessionsRoot, iterSessionFiles, forEachLine, MAX_SCAN_BYTES } = require('./sessions');

const LEDGER_VERSION = 2;
/** Day buckets older than this are dropped on the next refresh (the chart never asks for them). */
const RETENTION_DAYS = 3 * 365;
/** At most this many model keys in one day bucket, the `other` catch-all included. */
const MAX_MODELS_PER_DAY = 16;
/** How far up the fork chain to walk when deduplicating copied entries. */
const MAX_FORK_DEPTH = 8;
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
  return { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, msgs: 0, answers: 0, compactions: 0, branches: 0, other: 0 };
}

/**
 * Every numeric field of a bucket, in one place. The same array literal used to be written out four
 * times and two of the copies disagreed: the bucket/model passes included `other`, the totals passes
 * did not, so `totals.other` was always 0 while every bucket had a non-zero value (#13).
 */
const FIELDS = Object.freeze(['in', 'out', 'cacheRead', 'cacheWrite', 'total', 'cost', 'msgs', 'answers', 'compactions', 'branches', 'other']);

/** Add every FIELDS entry of `source` into `target`. */
function addFields(target, source) {
  for (const field of FIELDS) target[field] += source[field] || 0;
  return target;
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
  if (unit === 'month' || unit === 'year') return key;
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

function countKind(bucket, kind) {
  if (kind === 'answer') bucket.answers += 1;
  else if (kind === 'compaction') bucket.compactions += 1;
  else if (kind === 'branch') bucket.branches += 1;
  else bucket.other += 1;
}

/**
 * Read one session file and return its usage records in file order.
 *
 * pi stamps `usage` on four entry types (session-manager.d.ts): a `message` from the model, a
 * standalone `usage` entry (e.g. a cache warm), `compaction` (the LLM calls that produced the
 * summary) and `branch_summary` (the summary written when the tree is switched). The last two are
 * real model calls - skipping them would drop the price of compacting, which is exactly the
 * write-off this ledger exists to prevent.
 *
 * A record is dated by its own entry timestamp; when an entry has none, the session's first
 * timestamp is used, and failing that the file's mtime - a bucket is better than a dropped record,
 * and the `undated` / `truncated` flags say when a guess was made.
 */
function scanFile(filePath, stat) {
  const records = [];
  let firstTs = '';
  let sessionId = '';
  let parentSession = '';
  let currentModel = '';
  let undated = 0;

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

    if (entry.type === 'session') {
      sessionId = entry.id || '';
      parentSession = entry.parentSession || '';
      return;
    }
    if (entry.type === 'model_change') {
      if (entry.modelId) currentModel = entry.modelId;
      return;
    }

    let usage = null;
    let model = '';
    let kind = 'other';
    if (entry.type === 'message') {
      const message = entry.message;
      if (!message) return;
      if (message.model) currentModel = message.model;
      if (message.role !== 'assistant' || !message.usage) return;
      usage = message.usage;
      model = message.model || currentModel;
      kind = 'answer';
    } else if (entry.type === 'usage') {
      usage = entry.usage;
      model = entry.model || currentModel;
      kind = entry.kind ? `usage:${entry.kind}` : 'other';
    } else if (entry.type === 'compaction') {
      usage = entry.usage;
      model = currentModel;
      kind = 'compaction';
    } else if (entry.type === 'branch_summary') {
      usage = entry.usage;
      model = currentModel;
      kind = 'branch';
    } else {
      return;
    }
    if (!usage) return;

    const dayKey = dayKeyOf(ts || firstTs || stat.mtimeMs);
    if (!dayKey) return;
    if (!ts) undated += 1;
    records.push({ id: entry.id || '', dayKey, usage, model: model || UNKNOWN_MODEL, kind });
  });

  return { records, sessionId, parentSession, undated, truncated: stat.size > MAX_SCAN_BYTES };
}

/** Resolve a `parentSession` path to a file that exists (it may have moved with a group rename). */
function resolveSessionFile(parentPath, byName) {
  try {
    if (fs.existsSync(parentPath)) return parentPath;
  } catch {}
  const name = path.basename(String(parentPath || ''));
  return (name && byName.get(name)) || '';
}

/**
 * Entry ids of every usage record in the ancestor chain of a forked/clone session. pi copies the
 * parent's entries verbatim (ids included), so these records must not be counted a second time.
 */
function ancestorUsageIds(parentPath, byName, depth = 0) {
  const ids = new Set();
  if (!parentPath || depth > MAX_FORK_DEPTH) return ids;
  const file = resolveSessionFile(parentPath, byName);
  if (!file) return ids;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return ids;
  }
  let scanned;
  try {
    scanned = scanFile(file, stat);
  } catch {
    return ids;
  }
  for (const record of scanned.records) if (record.id) ids.add(record.id);
  if (scanned.parentSession) {
    for (const id of ancestorUsageIds(scanned.parentSession, byName, depth + 1)) ids.add(id);
  }
  return ids;
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

/** Add one usage record to an entry's day bucket (and its model split). Never subtracts. */
function bank(entry, record) {
  const day = entry.days[record.dayKey] || (entry.days[record.dayKey] = blank());
  if (!addUsage(day, record.usage)) return;
  countKind(day, record.kind);
  const models = day.models || (day.models = {});
  const key = record.model || UNKNOWN_MODEL;
  let modelBucket = models[key];
  if (!modelBucket) {
    if (Object.keys(models).length >= MAX_MODELS_PER_DAY - 1) {
      // deliberately NOT registered under `key`: a second key pointing at the same object would
      // make the model list count the overflow twice
      modelBucket = models[OTHER_MODEL] || (models[OTHER_MODEL] = blank());
    } else {
      modelBucket = models[key] = blank();
    }
  }
  addUsage(modelBucket, record.usage);
  countKind(modelBucket, record.kind);
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
 *
 * A changed file is re-scanned and only the records it has not banked yet are added: the watermark
 * (`countedCount` / `lastRecordId`) marks how far this file has been read before. Nothing here ever
 * removes an existing day bucket, so a session file being rewritten or truncated cannot write off
 * tokens that were already spent.
 */
/**
 * #10: the scan used to run synchronously on the main process, on the request path: `usage:summary`
 * is called after every settled run, every compaction, every window focus and every cleanup, and
 * `refresh()` walked every session file with `fs.openSync` / `fs.readSync` (up to MAX_SCAN_BYTES per
 * file) and then `JSON.stringify`'d and wrote the whole ledger. Anything that blocks the main process
 * blocks window messages, so a heavy chart refresh could present itself to the user as the "the
 * interface has stopped responding" dialog C9 turns into a Reload button.
 *
 * `refresh()` stays synchronous (the tests and the quit path use it). `refreshAsync()` is what the IPC
 * handlers call: it yields to the event loop every YIELD_EVERY_FILES files so a long scan can never
 * starve the window, it coalesces concurrent callers into ONE scan with a "someone asked while it
 * ran" flag instead of one scan per caller, and it keeps the ledger write off the request path.
 */
const YIELD_EVERY_FILES = 25;

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

let flushTimer = null;

/** Mark-and-write later: the rollup is cheap to redo, the request path is not the place to serialise it. */
function scheduleFlush(delayMs = 2000) {
  if (flushTimer) return false;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, delayMs);
  flushTimer.unref?.();
  return true;
}

function beginRefresh({ force = false, nowMs = Date.now() } = {}) {
  const current = load();
  const root = sessionsRoot();
  const files = iterSessionFiles(root);
  return {
    current,
    root,
    files,
    byName: new Map(files.map((file) => [path.basename(file), file])),
    seen: new Set(),
    counters: { parsed: 0, skipped: 0, failed: 0, banked: 0, deduped: 0 },
    force,
    nowMs,
  };
}

/** Bank one session file into the ledger. Shared by the sync and the async scan so they cannot drift. */
function scanOneFile(file, ctx) {
  const { current, byName, seen, counters, force, nowMs } = ctx;
  const name = path.basename(file);
  seen.add(name);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return; // deleted between the listing and the stat
  }
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  let entry = current.entries[name];
  if (entry && entry.stamp === stamp && !force) {
    entry.path = file;
    entry.gone = false;
    counters.skipped += 1;
    return;
  }
  try {
    const scanned = scanFile(file, stat);
    if (!entry) entry = current.entries[name] = { name, days: {}, countedCount: 0, lastRecordId: '' };
    entry.path = file;
    entry.stamp = stamp;
    entry.gone = false;
    entry.lastSeenMs = nowMs;
    entry.sessionId = scanned.sessionId || entry.sessionId || '';
    entry.undated = scanned.undated;
    entry.truncated = scanned.truncated;
    entry.parentSession = scanned.parentSession || '';

    const records = scanned.records;
    let startIndex = 0;
    let skipIds = null;
    if (entry.countedCount > 0) {
      // already read once: continue after the last record seen; if the file was rewritten and that
      // id is gone, assume the first `countedCount` records are the same ones
      const index = entry.lastRecordId ? records.findIndex((record) => record.id === entry.lastRecordId) : -1;
      startIndex = index >= 0 ? index + 1 : Math.min(entry.countedCount, records.length);
    } else if (scanned.parentSession) {
      // first read of a fork / clone: pi copied the parent's entries (ids included)
      skipIds = ancestorUsageIds(scanned.parentSession, byName);
      if (!skipIds.size) entry.dedupeMissed = true; // parent file is gone: those tokens may be counted twice
      else counters.deduped += records.filter((record) => record.id && skipIds.has(record.id)).length;
    }

    for (let index = startIndex; index < records.length; index += 1) {
      const record = records[index];
      if (skipIds && record.id && skipIds.has(record.id)) continue;
      bank(entry, record);
      counters.banked += 1;
    }
    entry.countedCount = records.length;
    entry.lastRecordId = records.length ? records[records.length - 1].id || entry.lastRecordId : entry.lastRecordId;
    counters.parsed += 1;
    dirty = true;
  } catch (err) {
    counters.failed += 1;
    console.error(`[usage-ledger] scan failed for ${file}: ${err.message}`);
  }
}

function finishRefresh(ctx) {
  const { current, seen, counters, nowMs, root } = ctx;
  for (const [name, entry] of Object.entries(current.entries)) {
    if (!seen.has(name) && !entry.gone) {
      entry.gone = true; // file deleted (D7 cleanup) or moved out of the sessions root
      dirty = true;
    }
  }
  prune(nowMs);
  return {
    root,
    ledgerFile,
    parsed: counters.parsed,
    skipped: counters.skipped,
    failed: counters.failed,
    banked: counters.banked,
    deduped: counters.deduped,
    entries: Object.keys(current.entries).length,
    gone: Object.values(current.entries).filter((entry) => entry.gone).length,
    truncated: Object.values(current.entries).filter((entry) => entry.truncated).length,
    dedupeMissed: Object.values(current.entries).filter((entry) => entry.dedupeMissed).length,
  };
}

function refresh(options = {}) {
  const ctx = beginRefresh(options);
  for (const file of ctx.files) scanOneFile(file, ctx);
  const result = finishRefresh(ctx);
  flush();
  return result;
}

/** One scan in flight; anyone who asks during it sets the flag instead of starting a second one. */
let inFlight = null;
let askedWhileRunning = false;
/** A pathological writer could keep re-triggering the trailing pass; never loop forever. */
const MAX_TRAILING_PASSES = 4;

function refreshAsync(options = {}) {
  if (inFlight) {
    askedWhileRunning = true;
    return inFlight;
  }
  const run = async () => {
    let result;
    let pass = 0;
    do {
      askedWhileRunning = false;
      const ctx = beginRefresh(options);
      let read = 0;
      for (const file of ctx.files) {
        scanOneFile(file, ctx);
        if (++read % YIELD_EVERY_FILES === 0) await yieldToEventLoop();
      }
      result = finishRefresh(ctx);
      pass += 1;
    } while (askedWhileRunning && pass < MAX_TRAILING_PASSES);
    scheduleFlush();
    result.passes = pass;
    return result;
  };
  const promise = run();
  const clear = () => {
    inFlight = null;
  };
  promise.then(clear, clear);
  inFlight = promise;
  return promise;
}

/** Any scan still in flight when the app quits: flush what has been banked so far. */
function cancelScheduledFlush() {
  if (!flushTimer) return false;
  clearTimeout(flushTimer);
  flushTimer = null;
  return true;
}

function recount() {
  const before = Object.keys(load().entries).length;
  ledger = { version: LEDGER_VERSION, updatedAt: '', entries: {} };
  dirty = true;
  const result = refresh({ force: true });
  result.entriesBefore = before;
  result.droppedGone = Math.max(0, before - result.entries);
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

  const touchBucket = (key) => {
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
      const bucket = touchBucket(key);
      addFields(bucket, day);
      sessionsPerBucket.get(key).add(name);
      for (const [model, modelDay] of Object.entries(day.models || {})) {
        let target = bucket.models.get(model);
        if (!target) {
          target = { ...blank() };
          bucket.models.set(model, target);
        }
        addFields(target, modelDay);
      }
    }
  }

  let keys = [...buckets.keys()].sort();
  if (fill && keys.length) keys = fillGaps(keys, kind);
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
      full: kind === 'week' ? `week of ${key}` : key,
      startMs,
      endMs,
      in: bucket.in,
      out: bucket.out,
      cacheRead: bucket.cacheRead,
      cacheWrite: bucket.cacheWrite,
      total: bucket.total,
      cost: bucket.cost,
      msgs: bucket.msgs,
      answers: bucket.answers,
      compactions: bucket.compactions,
      branches: bucket.branches,
      // the catch-all count: without it the `other` bucket a day can overflow into (more than
      // MAX_MODELS_PER_DAY models, usage entries that are not a reply/compaction/branch) was invisible
      // in the chart even though every day bucket carried it
      other: bucket.other,
      sessions: sessionsPerBucket.has(key) ? sessionsPerBucket.get(key).size : 0,
      models,
    };
  });

  const totals = out.reduce((sum, bucket) => addFields(sum, bucket), blank());

  const modelTotals = new Map();
  for (const bucket of out) {
    for (const model of bucket.models) {
      const target = modelTotals.get(model.model) || { model: model.model, ...blank() };
      addFields(target, model);
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
    dedupeMissed: Object.values(current.entries).filter((entry) => entry.dedupeMissed).length,
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
      if (!cursor || cursor === target) break;
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
    // the per-model split travels with the summary so the footer chip can price each model at its own
    // rate instead of guessing with one default
    allModels: all.models,
    entries: all.entries,
    gone: all.gone,
    truncated: all.truncated,
    dedupeMissed: all.dedupeMissed,
    dayCount: all.dayCount,
    ledgerFile,
    retentionDays: RETENTION_DAYS,
  };
}

// #28: LEDGER_VERSION, UNKNOWN_MODEL and scanFile are internal to the ledger format
module.exports = {
  RETENTION_DAYS,
  MAX_MODELS_PER_DAY,
  OTHER_MODEL,
  setLedgerFile,
  getLedgerFile,
  resetLedger,
  refresh,
  refreshAsync,
  cancelScheduledFlush,
  FIELDS,
  YIELD_EVERY_FILES,
  recount,
  series,
  summary,
  flush,
  dayKeyOf,
  bucketKey,
  bucketSpanMs,
  weekStartKey,
};
