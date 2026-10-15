'use strict';

/**
 * Scheduled prompts (B5) - the scheduler half.
 *
 * Deliberately hand-written: a 5-field cron parser is ~100 lines, and pulling in a dependency for
 * it would be the only runtime dependency this app has.
 *
 * Fields (standard cron, local time):   minute  hour  day-of-month  month  day-of-week
 * Values: star, a single value, a-b, a-b/step, star/step, and lists (a,b,c);
 *
 * Semantics that matter and are easy to get wrong:
 * - when BOTH day-of-month and day-of-week are restricted, a date matches if EITHER matches
 *   (Vixie cron), which is what everyone expects from `0 9 * * 1-5` plus `30 12 1 * *`.
 * - day-of-week 0 and 7 both mean Sunday.
 * - no DST handling beyond what Date gives us: a job that would land on a skipped hour simply runs
 *   at the next minute the clock shows (Windows has one such hour a year).
 *
 * The scheduler itself lives in main.js: it keeps nextRun per job, re-arms after a laptop woke up
 * (powerMonitor resume) and on a heartbeat, and never runs a prompt by itself - it tells the
 * renderer, which pushes the text into the target tab's outbox. That keeps the serial queue as the
 * only entry point for prompts, so Strata's single-flight rule is never violated.
 */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const FIELD_RANGES = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS },
  { name: 'dayOfWeek', min: 0, max: 7, names: DAYS },
];

/** Parse one field into { values:Set<number>, any:boolean, restricted:boolean }. */
function parseField(spec, range) {
  const values = new Set();
  let any = false;
  const parts = String(spec || '').trim().split(',');
  if (!parts.length || parts.some((part) => part === '')) throw new Error(`${range.name}: empty field`);
  for (const raw of parts) {
    const part = raw.trim();
    const match = /^([^/]+)(?:\/(\d+))?$/.exec(part);
    if (!match) throw new Error(`${range.name}: cannot read "${part}"`);
    const [, body, stepText] = match;
    const step = stepText ? Number(stepText) : 1;
    if (step < 1) throw new Error(`${range.name}: step must be >= 1 in "${part}"`);

    let low = range.min;
    let high = range.max;
    if (body === '*') {
      // a bare "*" leaves the field unrestricted; "*/5" is a step, so it still restricts it
      any = step === 1;
    } else if (body.includes('-')) {
      const [a, b] = body.split('-');
      low = toNumber(a, range);
      high = toNumber(b, range);
      if (low > high) throw new Error(`${range.name}: range ${a}-${b} counts backwards`);
    } else {
      low = high = toNumber(body, range);
      if (stepText && high === low) high = range.max; // "5/15" means "5, 20, 35, ... up to the max"
    }
    if (low < range.min || high > range.max) throw new Error(`${range.name}: ${part} is out of range ${range.min}-${range.max}`);
    for (let value = low; value <= high; value += step) values.add(normalize(range, value));
  }
  return { values, any, restricted: !any };
}

function normalize(range, value) {
  // both 0 and 7 mean Sunday
  if (range.name === 'dayOfWeek' && value === 7) return 0;
  return value;
}

function toNumber(text, range) {
  const trimmed = String(text || '').trim().toLowerCase();
  if (range.names && range.names[trimmed] != null) return range.names[trimmed];
  if (!/^\d+$/.test(trimmed)) throw new Error(`${range.name}: "${text}" is not a number or a name`);
  return Number(trimmed);
}

/** Parse a 5-field expression; throws with a message that says which field is wrong. */
function parseCron(expression) {
  const fields = String(expression || '').trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`expected 5 fields (minute hour day month weekday), got ${fields.length}: "${expression}"`);
  }
  const parsed = {};
  let domAny = false;
  let dowAny = false;
  FIELD_RANGES.forEach((range, index) => {
    const field = parseField(fields[index], range);
    parsed[range.name] = field;
    if (range.name === 'dayOfMonth') domAny = field.any;
    if (range.name === 'dayOfWeek') dowAny = field.any;
  });
  // Vixie cron: if both day fields are restricted, a day matches when either one does
  parsed.dayOrWeekday = !domAny && !dowAny;
  parsed.expression = String(expression).trim();
  return parsed;
}

function isValidCron(expression) {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

function dayMatches(parsed, date) {
  const domOk = parsed.dayOfMonth.values.has(date.getDate());
  const dowOk = parsed.dayOfWeek.values.has(date.getDay());
  return parsed.dayOrWeekday ? domOk || dowOk : domOk && dowOk;
}

/**
 * The first local-time minute strictly after `from` that matches, or null when the expression can
 * never fire (e.g. "0 0 30 2 *"). Day-level skipping keeps the loop small: at most ~366 day checks
 * plus 1440 minute checks for the day that matches.
 */
function nextRun(expression, from = new Date()) {
  const parsed = typeof expression === 'object' && expression ? expression : parseCron(expression);
  const start = from instanceof Date ? from : new Date(from);
  const minutes = [...parsed.minute.values].sort((a, b) => a - b);
  const hours = [...parsed.hour.values].sort((a, b) => a - b);

  const day = new Date(start.getTime());
  day.setHours(0, 0, 0, 0);
  const lastDay = new Date(start.getTime());
  lastDay.setDate(lastDay.getDate() + 400);

  while (day < lastDay) {
    if (parsed.month.values.has(day.getMonth() + 1) && dayMatches(parsed, day)) {
      for (const hour of hours) {
        for (const minute of minutes) {
          const candidate = new Date(day.getTime());
          candidate.setHours(hour, minute, 0, 0);
          if (candidate.getTime() > start.getTime()) return candidate;
        }
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return null;
}

/** One-line human description for the job list ("every weekday at 09:30"). */
function describeCron(expression) {
  let parsed;
  try {
    parsed = parseCron(expression);
  } catch (err) {
    return `invalid schedule: ${err.message}`;
  }
  const pad = (value) => String(value).padStart(2, '0');
  const minutes = [...parsed.minute.values].sort((a, b) => a - b);
  const hours = [...parsed.hour.values].sort((a, b) => a - b);
  const everyMinute = minutes.length === 60;
  const everyHour = hours.length === 24;
  let time;
  if (everyMinute) time = 'every minute';
  else if (everyHour && minutes.length === 1) time = `every hour at :${pad(minutes[0])}`;
  else if (everyHour) time = `every hour, minute ${minutes.map((m) => pad(m)).join(',')}`;
  else if (hours.length === 1) time = `at ${pad(hours[0])}:${minutes.map((m) => pad(m)).join(',')}`;
  else time = `at hours ${hours.map((h) => pad(h)).join(',')} minute ${minutes.map((m) => pad(m)).join(',')}`;

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dom = parsed.dayOfMonth;
  const dow = parsed.dayOfWeek;
  let when = 'every day';
  if (dom.restricted && dow.restricted) {
    when = `day ${[...dom.values].join(',')} or weekday ${[...dow.values].map((d) => DAY_NAMES[d]).join(',')}`;
  } else if (dow.restricted) {
    const all = [1, 2, 3, 4, 5];
    const set = [...dow.values];
    when = set.length === 7 || set.length === 0 ? 'every day' : set.every((d) => all.includes(d)) && set.length === 5 ? 'every weekday' : `every ${set.map((d) => DAY_NAMES[d]).join(', ')}`;
  } else if (dom.restricted) {
    when = `on day ${[...dom.values].join(',')} of the month`;
  }
  const months = parsed.month;
  const monthText = months.restricted ? ` in ${[...months.values].join(',')}` : '';
  return `${when}${monthText}, ${time}`;
}

module.exports = { parseCron, isValidCron, nextRun, describeCron, MONTHS, DAYS };
