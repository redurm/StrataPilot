'use strict';

/**
 * File logging for the Electron main process.
 *
 * Before this existed every console.log/console.error only reached the stdout of
 * whatever terminal launched `npm start`; launching the app from a shortcut or the
 * taskbar threw all of it away, and a crash left no trace at all (no crash dump,
 * no WER report, nothing in Event Viewer). This module mirrors the console to a
 * file under userData/logs/ so a crash can be diagnosed after the fact.
 *
 * Design notes:
 * - appendFileSync per line, not a buffered WriteStream: a stream loses its buffer
 *   when the process dies, which is exactly the case we care about.
 * - teeConsole() patches console.* so the ~20 existing call sites need no change.
 * - rotation keeps the file bounded; failures are swallowed so logging can never
 *   become the cause of a crash.
 */

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

const MAX_BYTES = 2 * 1024 * 1024; // rotate past ~2 MB
const KEEP = 2; // stratapilot.log, .1, .2
const MAX_LINE = 8000; // single record cap; pi stderr chunks are already capped at 4000

let logFile = null;
let currentBytes = 0;
let maxBytes = MAX_BYTES;
let keep = KEEP;

/** Absolute path of the active log file, or '' before init(). */
function logPath() {
  return logFile || '';
}

/** Directory holding the log file (handy for an "Open log folder" menu item). */
function logDir() {
  return logFile ? path.dirname(logFile) : '';
}

/**
 * Start logging to `filePath` (created, along with its parent folders).
 * `options.maxBytes` / `options.keep` exist so the unit tests can exercise
 * rotation without writing 2 MB; production uses the defaults.
 */
function init(filePath, options = {}) {
  logFile = filePath;
  maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : MAX_BYTES;
  keep = Number(options.keep) > 0 ? Number(options.keep) : KEEP;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    rotateIfNeeded();
    // touch the file so logPath() points at something that exists even before the
    // first record, and "Open Log Folder" always has a log to show
    fs.appendFileSync(logFile, '');
  } catch (err) {
    logFile = null; // logging disabled; the app must keep running without it
    console.error('[log] disabled, cannot open log file:', err.message);
  }
}

function stamp() {
  return new Date().toISOString();
}

function rotateIfNeeded() {
  if (!logFile) return;
  let size;
  try {
    size = fs.statSync(logFile).size;
  } catch {
    currentBytes = 0;
    return;
  }
  if (size < maxBytes) {
    currentBytes = size;
    return;
  }
  try {
    for (let n = keep - 1; n >= 1; n--) {
      const from = `${logFile}.${n}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${logFile}.${n + 1}`);
    }
    fs.renameSync(logFile, `${logFile}.1`);
    currentBytes = 0;
  } catch (err) {
    currentBytes = size; // keep appending to the oversized file rather than lose everything
    console.error('[log] rotation failed:', err.message);
  }
}

/** Append one `[ISO] [LEVEL] text` record. Never throws. */
function write(level, text) {
  if (!logFile) return;
  const line = `[${stamp()}] [${String(level).toUpperCase()}] ${String(text).slice(0, MAX_LINE)}\n`;
  try {
    rotateIfNeeded();
    fs.appendFileSync(logFile, line);
    currentBytes += Buffer.byteLength(line);
  } catch {
    // ignore: a failing log write must never take the app down
  }
}

/**
 * Patch console.log/info/warn/error/debug so every existing call site is mirrored
 * to the file. Original output still goes to stdout/stderr unchanged.
 * Returns a restore() that puts the real console back (used by the tests).
 */
function teeConsole() {
  const saved = new Map();
  for (const level of ['log', 'info', 'debug', 'warn', 'error']) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    saved.set(level, original);
    console[level] = (...args) => {
      original.apply(console, args);
      write(level, util.format(...args));
    };
  }
  return () => {
    for (const [level, original] of saved) console[level] = original;
  };
}

/** Startup banner: versions and paths, so a report can start from the log file alone. */
function banner(info) {
  write('info', `--- run start pid=${process.pid} ---`);
  for (const [key, value] of Object.entries(info || {})) write('info', `${key}=${value}`);
}

module.exports = { init, write, teeConsole, banner, logPath, logDir, MAX_BYTES, KEEP, MAX_LINE };
