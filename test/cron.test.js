'use strict';

/*
 * Unit tests for lib/cron.js (B5). The scheduler in main.js is thin (a timer plus an IPC send);
 * everything that can be wrong lives here: field parsing, the day-of-month / day-of-week rule, and
 * nextRun across month/year boundaries and after a laptop slept through the scheduled minute.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCron, isValidCron, nextRun, describeCron, schedulePreset } = require('../lib/cron');

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
  // a step field is described as a step, not as the list of minutes it expands to
  assert.equal(describeCron("*/15 * * * *"), "every day, every 15 minutes");
  assert.equal(describeCron("15 */3 * * *"), "every day, every 3 hours at :15");
  assert.equal(describeCron("0 8,12,18 * * *"), "every day, at hours 08,12,18 minute 00");
  assert.equal(describeCron('0 9 1 * *'), 'on day 1 of the month, at 09:00');
  assert.match(describeCron('* * * * *'), /every day, every minute/);
  assert.match(describeCron('0 0 * * 6,0'), /every Sat, Sun/);
});

test('describeCron: an invalid expression explains itself instead of throwing', () => {
  assert.match(describeCron('nope'), /^invalid schedule: /);
});

/* ---- schedulePreset: what the Jobs dialog prefills from a stored expression ---- */

test('schedulePreset: reads back every shape the builder can write', () => {
  assert.deepEqual(schedulePreset('30 9 * * 1-5'), { preset: 'weekdays', time: '09:30' });
  assert.deepEqual(schedulePreset('0 9 * * *'), { preset: 'daily', time: '09:00' });
  assert.deepEqual(schedulePreset('0 9 15 * *'), { preset: 'monthly', dayOfMonth: 15, time: '09:00' });
  assert.deepEqual(schedulePreset('*/5 * * * *'), { preset: 'minutes', step: 5 });
  assert.deepEqual(schedulePreset('15 */3 * * *'), { preset: 'hours', step: 3, minute: 15 });
  assert.deepEqual(schedulePreset('30 9 * * mon,wed'), { preset: 'weekly', days: [1, 3], time: '09:30' });
  assert.deepEqual(schedulePreset('7 8 * * 7'), { preset: 'weekly', days: [0], time: '08:07' });
  assert.deepEqual(schedulePreset('0 0 * * 0-6'), { preset: 'daily', time: '00:00' });
});

test('schedulePreset: anything the builder cannot express falls back to custom cron', () => {
  for (const expression of ['nope', '0 9 * jan-mar 1', '0 9,17 * * *', '0 0 30 2 *', '0 9 1 * 1', '0 9 * * */2', '']) {
    assert.equal(schedulePreset(expression).preset, 'custom', expression);
  }
});

test('schedulePreset: round-trips - the expression the builder builds reads back as the same preset', () => {
  // the builder in renderer/app.js writes these shapes; keep the two in step
  const built = {
    weekdays: '30 9 * * 1-5',
    daily: '30 9 * * *',
    weekly: '30 9 * * 0,2,4',
    monthly: '30 9 7 * *',
    hours: '15 */4 * * *',
    minutes: '*/20 * * * *',
  };
  for (const [preset, expression] of Object.entries(built)) {
    assert.equal(schedulePreset(expression).preset, preset, expression);
    assert.ok(isValidCron(expression), expression);
  }
});

/* ---- #9: a fire is not a run until the renderer acks it ---- */

const { fireKey, commitFire, rearmAfterUnackedFire, CRON_ACK_MS } = require('../lib/cron');

test('fireKey identifies one fire attempt, and two attempts are two keys', () => {
  const a = fireKey('job-1', '2026-10-20T01:30:00.000Z');
  assert.equal(a, fireKey('job-1', '2026-10-20T01:30:00.000Z'));
  assert.notEqual(a, fireKey('job-1', '2026-10-20T01:31:00.000Z'));
  assert.notEqual(a, fireKey('job-2', '2026-10-20T01:30:00.000Z'));
  assert.ok(CRON_ACK_MS > 0 && CRON_ACK_MS < 60000, `ack window must be short but not silly: ${CRON_ACK_MS}`);
});

test('commitFire moves lastRun and re-arms nextRun from the ack time, not from the fire time', () => {
  const job = { id: 'job-1', schedule: '30 9 * * *', name: 'morning', lastRun: '2026-10-19T01:30:00.000Z', nextRun: '2026-10-20T01:30:00.000Z' };
  const firedAt = '2026-10-20T01:30:00.000Z';
  const ackedAt = at(2026, 10, 20, 9, 31); // the renderer took 11 s (a reload was in flight)
  const next = commitFire(job, firedAt, ackedAt);
  assert.equal(next.lastRun, firedAt, 'the run is recorded with the time it was fired');
  assert.equal(next.nextRun, at(2026, 10, 21, 9, 30).toISOString(), 'the next run is tomorrow 09:30, not a re-fire of today');
  assert.notEqual(next, job, 'the helper returns a new object; it does not mutate the caller job');
  assert.equal(job.lastRun, '2026-10-19T01:30:00.000Z', 'the original is untouched');
});

test('rearmAfterUnackedFire leaves lastRun alone, so the missed run stays visible (#9)', () => {
  const job = { id: 'job-1', schedule: '30 9 * * *', name: 'morning', lastRun: '2026-10-19T01:30:00.000Z', nextRun: '2026-10-20T01:30:00.000Z' };
  const next = rearmAfterUnackedFire(job, at(2026, 10, 20, 9, 31));
  assert.equal(next.lastRun, '2026-10-19T01:30:00.000Z', 'an unacked fire must NOT count as a run');
  assert.equal(next.nextRun, at(2026, 10, 21, 9, 30).toISOString(), 're-armed so the 30s tick cannot fire the same prompt four times');
});

test('an invalid schedule cannot throw the scheduler out of its tick', () => {
  const job = { id: 'bad', schedule: 'not a cron', lastRun: null, nextRun: '2026-10-20T01:30:00.000Z' };
  assert.equal(commitFire(job, '2026-10-20T01:30:00.000Z', at(2026, 10, 20, 9, 30)).nextRun, null);
  assert.equal(rearmAfterUnackedFire(job, at(2026, 10, 20, 9, 30)).nextRun, null);
});

/* ---- #13: the jobs list is bounded, and the schedule text can be translated ---- */

const { sanitizeJobs, MAX_JOBS, MAX_PROMPT_CHARS } = require('../lib/cron');

test('sanitizeJobs: the shape was validated but nothing was bounded (#13)', () => {
  const base = { schedule: '30 9 * * *', prompt: 'do the thing' };
  assert.equal(sanitizeJobs([base]).length, 1);
  assert.throws(() => sanitizeJobs(new Array(MAX_JOBS + 1).fill(base)), /too many jobs/);
  assert.throws(() => sanitizeJobs([{ ...base, prompt: 'p'.repeat(MAX_PROMPT_CHARS + 1) }]), /prompt is longer than/);
  assert.throws(() => sanitizeJobs([{ ...base, name: 'n'.repeat(200) }]), /name is longer than/);
  assert.throws(() => sanitizeJobs([{ ...base, cwd: 'c'.repeat(600) }]), /cwd is longer than/);
  assert.throws(() => sanitizeJobs([{ ...base, target: `session:${'s'.repeat(600)}` }]), /target is longer than|target must be/);
  assert.throws(() => sanitizeJobs([{ ...base, schedule: 'x'.repeat(300) }]), /schedule is longer than/);
  // the message used to interpolate cron.parseCron.name; a function name is not user-facing text
  let message = '';
  try {
    sanitizeJobs([{ schedule: 'nope', prompt: 'x' }]);
  } catch (err) {
    message = err.message;
  }
  assert.match(message, /5-field cron expression \(minute hour day month weekday\)/);
  assert.ok(!message.includes('parseCron'), `the message must not leak an internal name: ${message}`);
});

test('describeCron: a caller can translate every phrase, and the fallback still fills the holes (#13)', () => {
  const seen = [];
  const tr = (text, params) => {
    seen.push(text);
    let out = text === 'every weekday' ? '每個工作日' : text;
    for (const [name, value] of Object.entries(params || {})) out = out.split(`{${name}}`).join(String(value));
    return out;
  };
  assert.equal(describeCron('30 9 * * 1-5', tr), '每個工作日, at 09:30');
  assert.ok(seen.includes('every weekday'), 'the phrase must reach the translator');
  assert.ok(seen.includes('at {time}'), 'the time is a phrase too, not string concatenation');
  // without a translator the English source is returned, with the {tokens} still filled
  assert.equal(describeCron('30 9 * * 1-5'), 'every weekday, at 09:30');
  assert.equal(describeCron('*/15 * * * *'), 'every day, every 15 minutes');
  assert.match(describeCron('bogus'), /^invalid schedule: /);
});
