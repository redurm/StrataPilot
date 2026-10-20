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
/** Same {name} substitution renderer/i18n.js does, so the untranslated fallback still fills. */
function fillTokens(text, params) {
  if (!params) return text;
  return String(text).replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/**
 * Human-readable schedule text for the Jobs list.
 *
 * It used to be hardcoded English with no way for a caller to translate it, so the Jobs dialog showed
 * "every weekday, at 09:30" to a zh-TW user who had translated every label around it (#13). Pass the
 * main-process `tr` and every phrase goes through the catalog; without it the English source is
 * returned unchanged, which is what the unit tests assert.
 */
function describeCron(expression, translate) {
  const t = typeof translate === 'function' ? translate : (text, params) => fillTokens(text, params);
  let parsed;
  try {
    parsed = parseCron(expression);
  } catch (err) {
    return t('invalid schedule: {message}', { message: err.message });
  }
  const pad = (value) => String(value).padStart(2, '0');
  const fields = String(parsed.expression).trim().split(/\s+/);
  const minutes = [...parsed.minute.values].sort((a, b) => a - b);
  const hours = [...parsed.hour.values].sort((a, b) => a - b);
  const everyMinute = minutes.length === 60;
  const everyHour = hours.length === 24;
  // a step field reads far better as "every 5 minutes" than as the list of minutes it expands to
  const minuteStep = /^\*\/(\d+)$/.exec(fields[0] || '');
  const hourStep = /^\*\/(\d+)$/.exec(fields[1] || '');
  let time;
  if (minuteStep && fields[1] === '*' && Number(minuteStep[1]) > 1) time = t('every {n} minutes', { n: Number(minuteStep[1]) });
  else if (hourStep && minutes.length === 1 && Number(hourStep[1]) > 1) time = t('every {n} hours at :{mm}', { n: Number(hourStep[1]), mm: pad(minutes[0]) });
  else if (everyMinute) time = t('every minute');
  else if (everyHour && minutes.length === 1) time = t('every hour at :{mm}', { mm: pad(minutes[0]) });
  else if (everyHour) time = t('every hour, minute {list}', { list: minutes.map((m) => pad(m)).join(',') });
  else if (hours.length === 1) time = t('at {time}', { time: `${pad(hours[0])}:${minutes.map((m) => pad(m)).join(',')}` });
  else time = t('at hours {hours} minute {minutes}', { hours: hours.map((h) => pad(h)).join(','), minutes: minutes.map((m) => pad(m)).join(',') });

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayName = (value) => t(DAY_NAMES[value]);
  const dom = parsed.dayOfMonth;
  const dow = parsed.dayOfWeek;
  let when = t('every day');
  if (dom.restricted && dow.restricted) {
    when = t('day {days} or weekday {names}', { days: [...dom.values].join(','), names: [...dow.values].map(dayName).join(',') });
  } else if (dow.restricted) {
    const all = [1, 2, 3, 4, 5];
    const set = [...dow.values];
    when = set.length === 7 || set.length === 0 ? t('every day') : set.every((d) => all.includes(d)) && set.length === 5 ? t('every weekday') : t('every {names}', { names: set.map(dayName).join(', ') });
  } else if (dom.restricted) {
    when = t('on day {days} of the month', { days: [...dom.values].join(',') });
  }
  const months = parsed.month;
  const monthText = months.restricted ? t(' in {months}', { months: [...months.values].join(',') }) : '';
  return `${when}${monthText}, ${time}`;
}

/** "1-5" / "mon,wed" / "0,7" -> sorted array of 0..6, or null when the field is anything else. */
function dayOfWeekValues(spec) {
  const days = new Set();
  for (const raw of String(spec || '').split(',')) {
    const part = String(raw).trim().toLowerCase();
    if (!part) return null;
    const edges = part.split('-').map((edge) => (DAYS[edge.trim()] != null ? DAYS[edge.trim()] : Number(edge.trim())));
    if (edges.some((n) => !Number.isInteger(n) || n < 0 || n > 7)) return null;
    if (edges.length === 1) days.add(normalize({ name: 'dayOfWeek' }, edges[0]));
    else if (edges.length === 2) {
      for (let n = edges[0]; n <= edges[1]; n++) days.add(normalize({ name: 'dayOfWeek' }, n));
    } else return null;
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * Which builder preset produced this expression, so the Jobs dialog can prefill its dropdown
 * instead of showing a bare cron string. Anything the builder cannot express (months, day-of-month
 * combined with weekdays, lists of hours) comes back as { preset: 'custom' } and the raw box is shown.
 */
function schedulePreset(expression) {
  const custom = { preset: 'custom' };
  const fields = String(expression || '').trim().split(/\s+/);
  if (fields.length !== 5) return custom;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const clock = (m, h) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const minuteNumber = /^\d{1,2}$/.test(minute) ? Number(minute) : null;
  const hourNumber = /^\d{1,2}$/.test(hour) ? Number(hour) : null;
  const dayNumber = /^\d{1,2}$/.test(dayOfMonth) ? Number(dayOfMonth) : null;
  const everyMinute = /^\*\/(\d{1,2})$/.exec(minute);
  const everyHour = /^\*\/(\d{1,2})$/.exec(hour);

  if (everyMinute && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && Number(everyMinute[1]) >= 1 && Number(everyMinute[1]) <= 59) {
    return { preset: 'minutes', step: Number(everyMinute[1]) };
  }
  if (everyHour && minuteNumber != null && minuteNumber <= 59 && Number(everyHour[1]) >= 1 && Number(everyHour[1]) <= 23 && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return { preset: 'hours', step: Number(everyHour[1]), minute: minuteNumber };
  }
  if (minuteNumber == null || hourNumber == null || minuteNumber > 59 || hourNumber > 23 || month !== '*') return custom;
  if (dayNumber != null && dayNumber >= 1 && dayNumber <= 31 && dayOfWeek === '*') {
    return { preset: 'monthly', dayOfMonth: dayNumber, time: clock(minuteNumber, hourNumber) };
  }
  if (dayOfMonth !== '*') return custom;
  if (dayOfWeek === '*') return { preset: 'daily', time: clock(minuteNumber, hourNumber) };
  const days = dayOfWeekValues(dayOfWeek);
  if (!days || !days.length) return custom;
  if (days.length === 7) return { preset: 'daily', time: clock(minuteNumber, hourNumber) };
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return { preset: 'weekdays', time: clock(minuteNumber, hourNumber) };
  return { preset: 'weekly', days, time: clock(minuteNumber, hourNumber) };
}

/**
 * #9: a fire is not a run. `cronTick()` used to send `cron:fire` and write `lastRun` / `nextRun` in
 * the same tick, while `send()` drops the event silently when the window is gone or reloading - which
 * is exactly what C9's crash recovery does. The job was then reported as having run (`firing "…"` in
 * the log, `lastRun` set, next run armed) and the user got no missed notice, because `cronRecompute()`
 * only reports runs whose STORED nextRun was slept through.
 *
 * So a fire now waits for the renderer to ack it with the same key, and only then is it committed.
 */

/** How long the renderer gets to accept a fired prompt. */
const CRON_ACK_MS = 5000;

/** Stable key for one fire attempt; the renderer echoes it back on the ack. */
function fireKey(jobId, firedAtIso) {
  return `${jobId}|${firedAtIso}`;
}

function nextRunOrNext(schedule, from) {
  try {
    const next = nextRun(schedule, from);
    return next ? next.toISOString() : null;
  } catch {
    return null;
  }
}

/** Commit a fire the renderer accepted: lastRun moves, nextRun is armed from the ack time. */
function commitFire(job, firedAtIso, now = new Date()) {
  return { ...job, lastRun: firedAtIso, nextRun: nextRunOrNext(job.schedule, now) };
}

/**
 * A fire nobody acked. Re-arm the next occurrence but leave `lastRun` alone, so the Jobs list and the
 * log keep saying this run did not happen. Re-arming (instead of leaving `nextRun` in the past) is
 * what stops the 30 s tick from firing the same prompt four times before the grace window closes -
 * the missed run is reported directly instead.
 */
function rearmAfterUnackedFire(job, now = new Date()) {
  return { ...job, nextRun: nextRunOrNext(job.schedule, now) };
}

/**
 * Caps for the jobs list (#13). `sanitizeJobs()` validated the SHAPE of everything but bounded
 * nothing: the list is written to userData/cron-jobs.json and re-read on every tick, and each prompt
 * is handed to pi as a turn. An unbounded list / prompt / name / cwd was one `cron:save` away from a
 * settings file the app re-reads every 15 s, and the renderer renders every row.
 */
const MAX_JOBS = 50;
const MAX_SCHEDULE_CHARS = 200;
const MAX_PROMPT_CHARS = 4000;
const MAX_NAME_CHARS = 120;
const MAX_CWD_CHARS = 500;
const MAX_TARGET_CHARS = 500;

/** Validate what the Jobs dialog sends; returns the sanitised list or throws with a clear message. */
function sanitizeJobs(input) {
  if (!Array.isArray(input)) throw new Error('jobs must be a list');
  if (input.length > MAX_JOBS) throw new Error(`too many jobs: ${input.length}, the limit is ${MAX_JOBS}`);
  const out = [];
  input.forEach((job, index) => {
    const source = job && typeof job === 'object' ? job : {};
    const schedule = String(source.schedule || '').trim();
    const prompt = String(source.prompt || '').trim();
    if (!schedule) throw new Error(`job ${index + 1}: schedule is empty`);
    if (schedule.length > MAX_SCHEDULE_CHARS) throw new Error(`job ${index + 1}: schedule is longer than ${MAX_SCHEDULE_CHARS} characters`);
    // the message used to interpolate `cron.parseCron.name` - a function name that changes when the
    // helper is renamed (or minified), which would make a user-facing error message nonsense
    if (!isValidCron(schedule)) {
      throw new Error(`job ${index + 1}: "${schedule}" is not a 5-field cron expression (minute hour day month weekday)`);
    }
    if (!prompt) throw new Error(`job ${index + 1}: prompt is empty`);
    if (prompt.length > MAX_PROMPT_CHARS) throw new Error(`job ${index + 1}: prompt is longer than ${MAX_PROMPT_CHARS} characters`);
    const target = String(source.target || 'new-tab').trim();
    if (target.length > MAX_TARGET_CHARS) throw new Error(`job ${index + 1}: target is longer than ${MAX_TARGET_CHARS} characters`);
    if (!['new-tab', 'tab:', 'session:'].some((prefix) => target === 'new-tab' || target.startsWith(prefix))) {
      throw new Error(`job ${index + 1}: target must be new-tab, tab:<id> or session:<path>`);
    }
    const name = String(source.name || '').trim() || schedule;
    if (name.length > MAX_NAME_CHARS) throw new Error(`job ${index + 1}: name is longer than ${MAX_NAME_CHARS} characters`);
    const cwd = String(source.cwd || '').trim();
    if (cwd.length > MAX_CWD_CHARS) throw new Error(`job ${index + 1}: cwd is longer than ${MAX_CWD_CHARS} characters`);
    out.push({
      id: String(source.id || `job-${Date.now().toString(36)}-${index}`).slice(0, 120),
      name,
      schedule,
      prompt,
      target,
      cwd,
      ephemeral: !!source.ephemeral,
      enabled: source.enabled !== false,
      createdAt: source.createdAt || new Date().toISOString(),
      lastRun: source.lastRun || null,
      nextRun: null,
    });
  });
  return out;
}

module.exports = {
  parseCron,
  isValidCron,
  nextRun,
  describeCron,
  schedulePreset,
  CRON_ACK_MS,
  fireKey,
  commitFire,
  rearmAfterUnackedFire,
  sanitizeJobs,
  MAX_JOBS,
  MAX_PROMPT_CHARS,
  MAX_NAME_CHARS,
  MAX_CWD_CHARS,
  MAX_SCHEDULE_CHARS,
  MAX_TARGET_CHARS,
};
