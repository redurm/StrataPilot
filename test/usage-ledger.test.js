'use strict';

/*
 * Unit tests for lib/usage-ledger.js (D9).
 *
 * Safety: PI_CODING_AGENT_SESSION_DIR is pointed at a throwaway temp dir before lib/sessions.js can
 * run, and the ledger file lives inside that same temp dir, so neither the real ~/.pi/agent/sessions
 * nor %APPDATA%\StrataPilot\token_usage.json is ever read or written by this test.
 *
 * Day keys are local-calendar on purpose, so the expected keys are built with the module's own
 * dayKeyOf() - the assertions hold whatever timezone the runner is in.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stratapilot-usage-'));
process.env.PI_CODING_AGENT_SESSION_DIR = tmpRoot;

const ledger = require('../lib/usage-ledger');
const { setLedgerFile, getLedgerFile, refresh, recount, series, summary, resetLedger, dayKeyOf, bucketKey, weekStartKey, RETENTION_DAYS } = ledger;

const ledgerPath = path.join(tmpRoot, 'token_usage.json');
const groupDir = path.join(tmpRoot, 'g1');
const otherGroupDir = path.join(tmpRoot, 'g2');

test.beforeEach(() => {
  fs.rmSync(groupDir, { recursive: true, force: true });
  fs.rmSync(otherGroupDir, { recursive: true, force: true });
  fs.mkdirSync(groupDir, { recursive: true });
  fs.mkdirSync(otherGroupDir, { recursive: true });
  fs.rmSync(ledgerPath, { force: true });
  setLedgerFile(ledgerPath);
});

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/* ---- helpers ---- */

function usage(input, output, cacheRead, cacheWrite, costTotal = 0) {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { total: costTotal },
  };
}

/** Write a session JSONL: `turns` is [{ day, in, out, cr, cw, model, cost }]. */
function writeSession(dir, fileName, turns, { startTs, model } = {}) {
  const lines = [];
  const first = startTs || `${dayKeyOf(new Date())}T08:00:00.000Z`;
  lines.push({ type: 'session', version: 3, id: fileName.replace(/\.jsonl$/, ''), timestamp: first, cwd: 'C:/work/demo' });
  for (const turn of turns) {
    const day = typeof turn.day === 'string' ? turn.day : dayKeyOf(new Date());
    lines.push({
      type: 'message',
      id: `m${lines.length}`,
      timestamp: `${day}T10:00:00.000Z`,
      message: { role: 'user', content: [{ type: 'text', text: `q on ${day}` }] },
    });
    if (turn.model && turn.model !== model) {
      lines.push({ type: 'model_change', id: `c${lines.length}`, timestamp: `${day}T10:00:01.000Z`, modelId: turn.model });
    }
    lines.push({
      type: 'message',
      id: `a${lines.length}`,
      timestamp: `${day}T10:00:05.000Z`,
      message: {
        role: 'assistant',
        model: turn.model || model || 'model-a',
        content: [{ type: 'text', text: 'answer' }],
        usage: usage(turn.in, turn.out, turn.cr || 0, turn.cw || 0, turn.cost || 0),
      },
    });
  }
  const target = path.join(dir, fileName);
  fs.writeFileSync(target, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf8');
  return target;
}

function appendTurn(filePath, turn) {
  const day = typeof turn.day === 'string' ? turn.day : dayKeyOf(new Date());
  const entry = {
    type: 'message',
    id: `a${Date.now()}`,
    timestamp: `${day}T11:00:00.000Z`,
    message: {
      role: 'assistant',
      model: turn.model || 'model-a',
      content: [{ type: 'text', text: 'more' }],
      usage: usage(turn.in, turn.out, turn.cr || 0, turn.cw || 0, turn.cost || 0),
    },
  };
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

function countOpensOf(needle, run) {
  const realOpen = fs.openSync;
  let opens = 0;
  fs.openSync = function patched(...args) {
    if (String(args[0]).includes(needle)) opens++;
    return realOpen.apply(fs, args);
  };
  try {
    return run();
  } finally {
    fs.openSync = realOpen;
  }
}

const today = () => dayKeyOf(new Date());
const daysAgo = (n) => dayKeyOf(new Date(Date.now() - n * 86400000));

/* ---- refresh(): building the rollup ---- */

test('refresh() folds assistant usage into local day buckets', () => {
  writeSession(groupDir, 's-1.jsonl', [
    { day: daysAgo(2), in: 100, out: 20, cr: 900, cw: 5 },
    { day: daysAgo(2), in: 50, out: 10, cr: 0, cw: 0 },
    { day: daysAgo(1), in: 7, out: 3, cr: 11, cw: 2 },
  ]);
  const info = refresh();
  assert.equal(info.parsed, 1);
  assert.equal(info.entries, 1);
  assert.equal(info.root, tmpRoot);
  assert.equal(getLedgerFile(), ledgerPath);

  const day = series({ unit: 'day' });
  assert.equal(day.buckets.length, 2);
  const older = day.buckets.find((bucket) => bucket.key === daysAgo(2));
  assert.deepEqual(
    { in: older.in, out: older.out, cacheRead: older.cacheRead, cacheWrite: older.cacheWrite, total: older.total, msgs: older.msgs },
    { in: 150, out: 30, cacheRead: 900, cacheWrite: 5, total: 1085, msgs: 2 },
  );
  assert.equal(older.sessions, 1, 'one session contributed to that day');
  assert.deepEqual(
    { in: day.totals.in, out: day.totals.out, cacheRead: day.totals.cacheRead, cacheWrite: day.totals.cacheWrite, total: day.totals.total },
    { in: 157, out: 33, cacheRead: 911, cacheWrite: 7, total: 1108 },
  );
});

test('in / out / cacheRead / cacheWrite stay apart - a cache-heavy day is visible as one', () => {
  writeSession(groupDir, 'cache-heavy.jsonl', [{ day: today(), in: 1000, out: 100, cr: 250000, cw: 4000 }]);
  refresh();
  const bucket = series({ unit: 'day' }).buckets[0];
  assert.ok(bucket.cacheRead > bucket.in * 100, 'cache reads dominate the column');
  assert.equal(bucket.total, 255100);
  // the chart stacks cacheRead under in/out, so the split has to survive the rollup
  assert.equal(bucket.cacheWrite, 4000);
});

test('usage is attributed per model, and a model switch inside a day is kept apart', () => {
  writeSession(groupDir, 'two-models.jsonl', [
    { day: today(), in: 10, out: 5, model: 'model-a' },
    { day: today(), in: 40, out: 8, model: 'model-b' },
  ]);
  refresh();
  const report = series({ unit: 'day' });
  const models = report.models.map((model) => ({ model: model.model, total: model.total }));
  assert.deepEqual(models.find((entry) => entry.model === 'model-a'), { model: 'model-a', total: 15 });
  assert.deepEqual(models.find((entry) => entry.model === 'model-b'), { model: 'model-b', total: 48 });
  assert.equal(report.totals.total, 63);
});

test('standalone usage entries (older pi logs) are counted too', () => {
  const file = path.join(groupDir, 'legacy.jsonl');
  fs.writeFileSync(
    file,
    [
      { type: 'session', version: 1, id: 'legacy', timestamp: `${today()}T07:00:00.000Z`, cwd: 'C:/work/demo' },
      { type: 'usage', id: 'u1', timestamp: `${today()}T07:30:00.000Z`, usage: usage(30, 12, 5, 0) },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n') + '\n',
    'utf8',
  );
  refresh();
  const bucket = series({ unit: 'day' }).buckets[0];
  assert.equal(bucket.in, 30);
  assert.equal(bucket.out, 12);
  assert.equal(bucket.cacheRead, 5);
});

test('a usage entry with no timestamp falls back to the session start day instead of being dropped', () => {
  const file = path.join(groupDir, 'undated.jsonl');
  const startDay = daysAgo(3);
  fs.writeFileSync(
    file,
    [
      { type: 'session', version: 1, id: 'undated', timestamp: `${startDay}T07:00:00.000Z`, cwd: 'C:/work/demo' },
      { type: 'message', id: 'a1', message: { role: 'assistant', model: 'model-a', content: [], usage: usage(9, 4, 0, 0) } },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n') + '\n',
    'utf8',
  );
  refresh();
  const keys = series({ unit: 'day' }).buckets.map((bucket) => bucket.key);
  assert.ok(keys.includes(startDay), `expected ${startDay} in ${keys.join(',')}`);
});

test('cost adds up across a day', () => {
  writeSession(groupDir, 'costed.jsonl', [
    { day: today(), in: 1, out: 1, cost: 0.25 },
    { day: today(), in: 1, out: 1, cost: 0.5 },
  ]);
  refresh();
  const report = series({ unit: 'day' });
  assert.ok(Math.abs(report.totals.cost - 0.75) < 1e-9, `cost=${report.totals.cost}`);
});

/* ---- incremental scan ---- */

test('an unchanged session file is never opened again (same stamp trick as B3)', () => {
  const file = writeSession(groupDir, 'stable.jsonl', [{ day: today(), in: 1, out: 1 }]);
  const first = countOpensOf('stable.jsonl', () => refresh());
  assert.ok(first.parsed >= 1, 'the first refresh must read the file');
  const second = countOpensOf('stable.jsonl', () => refresh());
  assert.equal(second.parsed, 0, 'nothing changed, so nothing may be re-read');
  assert.equal(second.skipped, 1);
  assert.equal(series({ unit: 'day' }).totals.total, 2, 'the rollup survives the skip');
  assert.ok(fs.existsSync(file));
});

test('a growing session file is re-read and its day bucket updated', () => {
  const file = writeSession(groupDir, 'growing.jsonl', [{ day: today(), in: 10, out: 5 }]);
  refresh();
  assert.equal(series({ unit: 'day' }).totals.total, 15);
  appendTurn(file, { day: today(), in: 6, out: 4 });
  const info = refresh();
  assert.equal(info.parsed, 1, 'the changed file must be re-parsed');
  assert.equal(series({ unit: 'day' }).totals.total, 25);
});

test('the ledger is written to disk and re-read without touching the session files again', () => {
  writeSession(groupDir, 'persisted.jsonl', [{ day: today(), in: 100, out: 40, cr: 800 }]);
  refresh();
  assert.ok(fs.existsSync(ledgerPath), 'the ledger file must exist after a refresh');
  resetLedger(); // as if the app restarted
  const report = countOpensOf('persisted.jsonl', () => series({ unit: 'day' }));
  assert.equal(report.totals.total, 940);
  assert.equal(report.entries, 1, 'the rollup came from the ledger file, not from the session');
});

test('a session file that moved to another folder group keeps its history (path rename case)', () => {
  const file = writeSession(groupDir, 'moved.jsonl', [{ day: daysAgo(1), in: 10, out: 10 }]);
  refresh();
  assert.equal(series({ unit: 'day' }).totals.total, 20);
  const movedTo = path.join(otherGroupDir, 'moved.jsonl');
  fs.mkdirSync(otherGroupDir, { recursive: true });
  fs.renameSync(file, movedTo);
  const info = refresh();
  assert.equal(info.entries, 1, 'the file name is the key, so a move is not a new session');
  assert.equal(info.gone, 0, 'the entry followed the file instead of being orphaned');
  assert.equal(series({ unit: 'day' }).totals.total, 20, 'and it is not counted twice');
});

/* ---- deleted sessions ---- */

test('deleting a session file keeps its usage history; recount() drops it', () => {
  const file = writeSession(groupDir, 'doomed.jsonl', [{ day: today(), in: 500, out: 100 }]);
  refresh();
  assert.equal(series({ unit: 'day' }).totals.in, 500);
  fs.rmSync(file, { force: true });
  const info = refresh();
  assert.equal(info.gone, 1);
  assert.equal(series({ unit: 'day' }).totals.in, 500, 'a D7 cleanup must not erase the record of what it cost');
  const recounted = recount();
  assert.equal(recounted.droppedGone, 1);
  assert.equal(series({ unit: 'day' }).buckets.length, 0, 'recount means "match what is on disk"');
});

/* ---- granularity ---- */

test('week buckets group by Monday-start weeks', () => {
  const thisMonday = weekStartKey(today());
  const previousMonday = dayKeyOf(new Date(new Date(`${thisMonday}T12:00:00`).getTime() - 7 * 86400000));
  writeSession(groupDir, 'weeks.jsonl', [
    { day: previousMonday, in: 10, out: 1 },
    { day: thisMonday, in: 20, out: 2 },
    { day: today(), in: 30, out: 3 },
  ]);
  refresh();
  const weeks = series({ unit: 'week' });
  assert.deepEqual(weeks.buckets.map((bucket) => bucket.key), [previousMonday, thisMonday], 'one column per week');
  assert.equal(weeks.buckets.find((bucket) => bucket.key === thisMonday).in, 50, "today and this week's Monday fold into one column");
  assert.equal(weeks.buckets.find((bucket) => bucket.key === previousMonday).in, 10);
  assert.equal(weekStartKey(today()), thisMonday);
});

test('month and year buckets fold the days inside them', () => {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonth = now.getMonth() === 0 ? `${now.getFullYear() - 1}-12` : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;
  // fixed days inside each month: "N days ago" would straddle a month boundary on the 1st
  writeSession(groupDir, 'months.jsonl', [
    { day: `${thisMonth}-01`, in: 1, out: 1 },
    { day: `${thisMonth}-02`, in: 1, out: 1 },
    { day: `${lastMonth}-15`, in: 5, out: 5 },
  ]);
  refresh();
  const months = series({ unit: 'month' });
  assert.deepEqual(months.buckets.map((bucket) => bucket.key), [lastMonth, thisMonth]);
  assert.equal(months.buckets.find((bucket) => bucket.key === thisMonth).in, 2);
  assert.equal(months.buckets.find((bucket) => bucket.key === lastMonth).in, 5);
  const years = series({ unit: 'year' });
  assert.equal(years.totals.in, 7, 'the year columns add up to the same total');
  assert.ok(years.buckets.every((bucket) => /^\d{4}$/.test(bucket.key)), `year keys: ${years.buckets.map((b) => b.key).join(',')}`);
  assert.ok(years.buckets.length <= 2, 'this month and last month are at most one year apart');
  assert.ok(years.buckets.some((bucket) => bucket.key === String(now.getFullYear())), 'this year is present');
});

test('fill inserts the empty periods so the x axis is a real time axis', () => {
  writeSession(groupDir, 'gappy.jsonl', [
    { day: daysAgo(0), in: 1, out: 1 },
    { day: daysAgo(4), in: 1, out: 1 },
  ]);
  refresh();
  const days = series({ unit: 'day' });
  assert.equal(days.buckets.length, 5, 'four empty days between the two that have data');
  assert.equal(days.buckets.filter((bucket) => bucket.total === 0).length, 3);
  const noFill = series({ unit: 'day', fill: false });
  assert.equal(noFill.buckets.length, 2);
});

test('limit keeps the newest buckets only, and totals follow the visible range', () => {
  for (let i = 0; i < 10; i += 1) {
    writeSession(groupDir, `many-${i}.jsonl`, [{ day: daysAgo(i), in: i + 1, out: 0 }]);
  }
  refresh();
  const last3 = series({ unit: 'day', limit: 3 });
  assert.equal(last3.buckets.length, 3);
  assert.deepEqual(last3.buckets.map((bucket) => bucket.key), [daysAgo(2), daysAgo(1), daysAgo(0)]);
  assert.equal(last3.totals.in, 1 + 2 + 3, 'totals are the range, not the whole ledger');
});

test('fromMs / toMs bound the range on the local calendar', () => {
  writeSession(groupDir, 'ranged.jsonl', [
    { day: daysAgo(0), in: 1, out: 0 },
    { day: daysAgo(5), in: 10, out: 0 },
    { day: daysAgo(40), in: 100, out: 0 },
  ]);
  refresh();
  const week = series({ unit: 'day', fromMs: Date.now() - 7 * 86400000, toMs: Date.now() });
  assert.equal(week.totals.in, 11, 'the 40-days-ago bucket is out of range');
  assert.equal(week.buckets.length, 6, 'filled days between the two in range');
});

test('bucket keys and spans line up for every unit', () => {
  assert.equal(bucketKey('2026-03-05', 'month'), '2026-03');
  assert.equal(bucketKey('2026-03-05', 'year'), '2026');
  assert.equal(bucketKey('2026-03-05', 'week'), '2026-03-02', '2026-03-05 is a Thursday, week starts Monday 03-02');
  const [start, end] = ledger.bucketSpanMs('2026-03', 'month');
  assert.equal(dayKeyOf(new Date(start)), '2026-03-01');
  assert.equal(dayKeyOf(new Date(end)), '2026-03-31');
  const [yearStart, yearEnd] = ledger.bucketSpanMs('2026', 'year');
  assert.equal(dayKeyOf(new Date(yearStart)), '2026-01-01');
  assert.equal(dayKeyOf(new Date(yearEnd)), '2026-12-31');
});

/* ---- retention ---- */

test('day buckets older than the retention window are dropped', () => {
  const ancient = dayKeyOf(new Date(Date.now() - (RETENTION_DAYS + 400) * 86400000));
  writeSession(groupDir, 'ancient.jsonl', [
    { day: ancient, in: 999, out: 999 },
    { day: today(), in: 1, out: 0 },
  ]);
  refresh();
  const report = series({ unit: 'year' });
  assert.equal(report.totals.in, 1, `${ancient} must have been pruned`);
  assert.ok(RETENTION_DAYS >= 365, 'retention is at least a year, so a yearly chart still has data');
});

/* ---- summary + misc ---- */

test('summary() reports all-time plus the last 7 and 30 days', () => {
  writeSession(groupDir, 'summary.jsonl', [
    { day: today(), in: 8, out: 2 },
    { day: daysAgo(10), in: 80, out: 20 },
    { day: daysAgo(200), in: 800, out: 200 },
  ]);
  refresh();
  const sums = summary();
  assert.equal(sums.all.in, 888);
  assert.equal(sums.last30.in, 88, 'the 200-days-ago session is outside 30 days');
  assert.equal(sums.last7.in, 8);
  assert.equal(sums.entries, 1);
  assert.equal(sums.ledgerFile, ledgerPath);
});

test('a sessions root that does not exist yields an empty report instead of throwing', () => {
  fs.rmSync(groupDir, { recursive: true, force: true });
  fs.rmSync(otherGroupDir, { recursive: true, force: true });
  const info = refresh();
  assert.equal(info.entries, 0);
  assert.equal(info.failed, 0);
  assert.deepEqual(series().buckets, []);
  assert.equal(summary().all.total, 0);
});

test('a corrupt ledger file is ignored and rebuilt from the sessions', () => {
  writeSession(groupDir, 'rebuild.jsonl', [{ day: today(), in: 3, out: 1 }]);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, '{"version":1,"entries":{"broken":', 'utf8'); // half-written
  setLedgerFile(ledgerPath);
  const info = refresh();
  assert.equal(info.entries, 1);
  assert.equal(series({ unit: 'day' }).totals.total, 4);
});

test('a ledger written by another version is ignored rather than trusted', () => {
  writeSession(groupDir, 'future.jsonl', [{ day: today(), in: 3, out: 1 }]);
  fs.writeFileSync(ledgerPath, JSON.stringify({ version: 999, entries: { 'future.jsonl': { days: { [today()]: { in: 1e9 } } } } }), 'utf8');
  setLedgerFile(ledgerPath);
  refresh();
  assert.equal(series({ unit: 'day' }).totals.in, 3, 'the stale 1e9 from the unknown version must not leak in');
});

test('more than the model cap in one day folds the overflow into "other" without double counting', () => {
  const turns = [];
  for (let i = 0; i < ledger.MAX_MODELS_PER_DAY + 4; i += 1) {
    turns.push({ day: today(), in: 1, out: 0, model: `model-${i}` });
  }
  writeSession(groupDir, 'many-models.jsonl', turns);
  refresh();
  const report = series({ unit: 'day' });
  assert.equal(report.totals.in, turns.length, 'every turn is counted exactly once');
  assert.ok(report.models.length <= ledger.MAX_MODELS_PER_DAY, `model list is capped (${report.models.length})`);
  assert.ok(report.models.some((model) => model.model === ledger.OTHER_MODEL), 'the overflow is visible as other');
});
