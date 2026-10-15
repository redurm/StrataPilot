'use strict';

/*
 * Unit tests for lib/cron.js (B5). The scheduler in main.js is thin (a timer plus an IPC send);
 * everything that can be wrong lives here: field parsing, the day-of-month / day-of-week rule, and
 * nextRun across month/year boundaries and after a laptop slept through the scheduled minute.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCron, isValidCron, nextRun, describeCron } = require('../lib/cron');

/** Local-time Date builder (cron is evaluated in local time, like the OS clock). */
function at(year, month, day, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function iso(date) {
  if (!date) return null;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} d${date.getDay()}`;
}

/* ---- parsing ---- */

test('parseCron: five fields, whitespace tolerant', () => {
  const parsed = parseCron('  0   9  *  *  1-5  ');
  assert.deepEqual([...parsed.minute.values], [0]);
  assert.deepEqual([...parsed.hour.values], [9]);
  assert.equal(parsed.dayOfWeek.restricted, true);
  assert.equal(parsed.dayOfMonth.restricted, false);
});

test('parseCron: rejects the wrong field count with a readable message', () => {
  assert.throws(() => parseCron('* *'), /expected 5 fields/);
  assert.throws(() => parseCron('0 9 * * 1-5 extra'), /expected 5 fields/);
  assert.throws(() => parseCron(''), /expected 5 fields/);
});

test('parseCron: ranges, lists, steps and named months/weekdays', () => {
  assert.deepEqual([...parseCron('*/15 * * * *').minute.values], [0, 15, 30, 45]);
  assert.deepEqual([...parseCron('0,30 8,20 * * *').minute.values], [0, 30]);
  assert.deepEqual([...parseCron('0,30 8,20 * * *').hour.values], [8, 20]);
  assert.deepEqual([...parseCron('5/20 * * * *').minute.values], [5, 25, 45]);
  assert.deepEqual([...parseCron('0 0 * jan-mar *').month.values], [1, 2, 3]);
  assert.deepEqual([...parseCron('0 0 * * mon-fri').dayOfWeek.values], [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseCron('0 0 * * sat,sun').dayOfWeek.values], [6, 0]);
});

test('parseCron: day-of-week 0 and 7 are both Sunday', () => {
  assert.deepEqual([...parseCron('0 0 * * 0').dayOfWeek.values], [0]);
  assert.deepEqual([...parseCron('0 0 * * 7').dayOfWeek.values], [0]);
});

test('parseCron: out of range, backwards ranges and junk are rejected per field', () => {
  assert.throws(() => parseCron('60 * * * *'), /minute: 60 is out of range 0-59/);
  assert.throws(() => parseCron('* 24 * * *'), /hour/);
  assert.throws(() => parseCron('* * 0 * *'), /dayOfMonth/);
  assert.throws(() => parseCron('* * * * 8'), /dayOfWeek/);
  assert.throws(() => parseCron('30-10 * * * *'), /counts backwards/);
  assert.throws(() => parseCron('abc * * * *'), /minute: "abc" is not a number or a name/);
  assert.throws(() => parseCron('*/0 * * * *'), /step must be >= 1/);
  assert.throws(() => parseCron('1,,2 * * * *'), /minute: empty field/);
  assert.equal(isValidCron('0 9 * * 1-5'), true);
  assert.equal(isValidCron('0 9 * *'), false);
});

test('parseCron: a bare * is unrestricted, */5 still restricts', () => {
  assert.equal(parseCron('* * 1-31 * *').dayOfMonth.restricted, true);
  assert.equal(parseCron('* * * * *').dayOfMonth.restricted, false);
  assert.equal(parseCron('* * */2 * *').dayOfMonth.restricted, true);
});

/* ---- day-of-month vs day-of-week (Vixie rule) ---- */

test('both day fields restricted: a day matches when EITHER matches', () => {
  // 2026-03-02 is a Monday; the 2nd of the month is also listed
  const every2ndOrMonday = parseCron('0 12 2 * 1');
  assert.equal(iso(nextRun(every2ndOrMonday, at(2026, 3, 1, 0, 0))), '2026-03-02 12:00 d1'); // Monday wins
  assert.equal(iso(nextRun(every2ndOrMonday, at(2026, 3, 3, 13, 0))), '2026-03-09 12:00 d1'); // next Monday
  assert.equal(iso(nextRun(parseCron('0 12 15 * 5'), at(2026, 3, 16, 0, 0))), '2026-03-20 12:00 d5'); // Friday
});

test('only one day field restricted: that field alone decides', () => {
  assert.equal(iso(nextRun('0 9 * * 1-5', at(2026, 3, 6, 10, 0))), '2026-03-09 09:00 d1'); // Fri -> Mon
  assert.equal(iso(nextRun('0 9 15 * *', at(2026, 3, 1, 0, 0))), '2026-03-15 09:00 d0');
});

/* ---- nextRun ---- */

test('nextRun: strictly after the given instant, never the same minute again', () => {
  const from = at(2026, 3, 9, 9, 0);
  assert.equal(iso(nextRun('0 9 * * *', from)), '2026-03-10 09:00 d2');
  assert.equal(iso(nextRun('0 9 * * *', at(2026, 3, 9, 8, 59))), '2026-03-09 09:00 d1');
});

test('nextRun: every-minute and hourly expressions', () => {
  assert.equal(iso(nextRun('* * * * *', at(2026, 3, 9, 9, 0, 30))), '2026-03-09 09:01 d1');
  assert.equal(iso(nextRun('0 * * * *', at(2026, 3, 9, 9, 0))), '2026-03-09 10:00 d1');
  assert.equal(iso(nextRun('*/20 * * * *', at(2026, 3, 9, 9, 25))), '2026-03-09 09:40 d1');
});

test('nextRun: weekday schedule skips the weekend', () => {
  // 2026-03-06 is a Friday
  assert.equal(iso(nextRun('30 8 * * 1-5', at(2026, 3, 6, 9, 0))), '2026-03-09 08:30 d1');
  assert.equal(iso(nextRun('30 8 * * 1-5', at(2026, 3, 6, 7, 0))), '2026-03-06 08:30 d5');
});

test('nextRun: month rollover and year rollover', () => {
  assert.equal(iso(nextRun('0 0 1 * *', at(2026, 3, 1, 12, 0))), '2026-04-01 00:00 d3');
  assert.equal(iso(nextRun('59 23 31 12 *', at(2026, 6, 1, 0, 0))), '2026-12-31 23:59 d4');
  assert.equal(iso(nextRun('0 3 1 1 *', at(2026, 6, 1, 0, 0))), '2027-01-01 03:00 d5', 'crosses into next year');
});

test('nextRun: an impossible date never fires', () => {
  assert.equal(nextRun('0 0 30 2 *', at(2026, 1, 1, 0, 0)), null);
  assert.equal(nextRun('0 0 31 2 *', at(2026, 1, 1, 0, 0)), null);
});

test('nextRun: a laptop that slept through the scheduled minute catches up on the next day only', () => {
  // job at 09:30 Mon-Fri; the machine woke at Friday 11:00, so the missed 09:30 is not replayed
  assert.equal(iso(nextRun('30 9 * * 1-5', at(2026, 3, 6, 11, 0))), '2026-03-09 09:30 d1');
  // ...and a */15 job simply resumes with the next quarter, no burst of missed runs
  assert.equal(iso(nextRun('*/15 * * * *', at(2026, 3, 6, 11, 3))), '2026-03-06 11:15 d5');
});

test('nextRun: day-of-month with a step and a restricted month', () => {
  assert.equal(iso(nextRun('0 12 */10 6 *', at(2026, 3, 1, 0, 0))), '2026-06-01 12:00 d1');
  assert.equal(iso(nextRun('0 12 */10 6 *', at(2026, 6, 12, 0, 0))), '2026-06-21 12:00 d0');
});

test('nextRun: accepts an already parsed expression (the scheduler re-uses it)', () => {
  const parsed = parseCron('0 9 * * 1-5');
  assert.equal(iso(nextRun(parsed, at(2026, 3, 6, 12, 0))), '2026-03-09 09:00 d1');
});

/* ---- describeCron (the job list text) ---- */

test('describeCron: the shapes the job editor offers', () => {
  assert.equal(describeCron('30 9 * * 1-5'), 'every weekday, at 09:30');
  assert.equal(describeCron("0 * * * *"), "every day, every hour at :00");
  assert.equal(describeCron("*/15 * * * *"), "every day, every hour, minute 00,15,30,45");
  assert.equal(describeCron("0 8,12,18 * * *"), "every day, at hours 08,12,18 minute 00");
  assert.equal(describeCron('0 9 1 * *'), 'on day 1 of the month, at 09:00');
  assert.match(describeCron('* * * * *'), /every day, every minute/);
  assert.match(describeCron('0 0 * * 6,0'), /every Sat, Sun/);
});

test('describeCron: an invalid expression explains itself instead of throwing', () => {
  assert.match(describeCron('nope'), /^invalid schedule: /);
});
