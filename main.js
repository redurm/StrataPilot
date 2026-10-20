'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell, Menu, clipboard, powerMonitor } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PiRpcProcess } = require('./lib/pi-process');
const { resolvePiInvocation, TESTED_PI_VERSION, piVersionStatus } = require('./lib/pi-launch');
const sessions = require('./lib/sessions');
const usageLedger = require('./lib/usage-ledger');
const appLog = require('./lib/log');
const diagnostics = require('./lib/diagnostics');
const cron = require('./lib/cron');
const netPolicy = require('./lib/net-policy');
const fsGuard = require('./lib/fs-guard');
const { resolveCaptureTarget } = require('./lib/smoke-shot');
const { disposeAll, QUIT_GRACE_MS } = require('./lib/shutdown');
// D10: the i18n core is shared with the renderer (one file, UMD) so both processes translate the same way
const i18n = require('./renderer/i18n');

const APP_ID = 'com.stratapilot.app';
const SETTINGS_NAME = 'stratapilot_settings.json';
const SETTINGS_FILE = () => path.join(app.getPath('userData'), SETTINGS_NAME);
// D9: the token usage rollup (day buckets per session) lives next to the settings file
const USAGE_LEDGER_NAME = 'token_usage.json';
const USAGE_LEDGER_FILE = () => path.join(app.getPath('userData'), USAGE_LEDGER_NAME);

/**
 * The app was renamed "Pi on Strata" -> "StrataPilot", which moved the environment prefix
 * (PI_ON_STRATA_* -> STRATAPILOT_*). Copy any old name onto the new one so existing shells, CI
 * run blocks and IDE launch configs keep working; the new name always wins.
 */
const LEGACY_ENV_PREFIX = 'PI_ON_STRATA_';
const NEW_ENV_PREFIX = 'STRATAPILOT_';
function migrateEnv() {
  try {
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith(LEGACY_ENV_PREFIX)) continue;
      const renamed = NEW_ENV_PREFIX + key.slice(LEGACY_ENV_PREFIX.length);
      if (process.env[renamed] === undefined) process.env[renamed] = value;
    }
  } catch (err) {
    console.error('[env] migration failed:', err.message);
  }
}
migrateEnv();

/**
 * The app was renamed from pi-gui to "Pi on Strata" and then to "StrataPilot". Electron derives
 * userData from the app name, so the settings folder moved %APPDATA%\pi-gui -> "Pi on Strata" ->
 * StrataPilot. Carry the first file that still exists forward once (the closest rename first), so
 * open tabs, window bounds and monitor preferences survive every hop.
 */
function migrateSettings() {
  const target = SETTINGS_FILE();
  try {
    if (fs.existsSync(target)) return;
    const appData = path.dirname(app.getPath('userData'));
    const candidates = [
      path.join(app.getPath('userData'), 'pi_on_strata_settings.json'),
      path.join(appData, 'Pi on Strata', 'pi_on_strata_settings.json'),
      path.join(app.getPath('userData'), 'pi_gui_settings.json'),
      path.join(appData, 'pi-gui', 'pi_gui_settings.json'),
    ];
    for (const from of candidates) {
      if (from === target || !fs.existsSync(from)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(from, target);
      console.log(`[settings] migrated ${from} -> ${target}`);
      return;
    }
  } catch (err) {
    console.error('[settings] migration failed:', err.message);
  }
}

/** tabId -> PiRpcProcess */
const processes = new Map();

let win = null;

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  writeSettings(settings);
}

function writeSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('settings save failed:', err.message);
  }
}

/* ------------------------------------------------------------------ */
/* #6: what the renderer may touch                                     */
/* ------------------------------------------------------------------ */

/**
 * Folders the user picked in a dialog. `fs:read-text` is confined to the app's own roots plus these:
 * the user choosing a folder in a dialog IS the consent, a renderer naming a path at random is not.
 */
const chosenDirs = new Set();
const CHOSEN_MAX = 64;

function noteChosen(target) {
  if (!target) return;
  let dir = String(target);
  try {
    dir = fs.statSync(dir).isDirectory() ? dir : path.dirname(dir);
  } catch {
    dir = path.dirname(dir);
  }
  chosenDirs.add(path.resolve(dir));
  if (chosenDirs.size > CHOSEN_MAX) chosenDirs.delete(chosenDirs.keys().next().value);
}

function readRoots() {
  return [sessions.sessionsRoot(), app.getPath('userData'), ...chosenDirs];
}

/**
 * What `fs:stat-paths` must never report on: the folder that holds the Strata key, and this app's own
 * settings/ledger files. Statting stays open everywhere else - drag & drop stats whatever the user
 * dropped, and the channel returns metadata only (name / size / isDirectory / ext), never contents.
 */
function deniedStatPaths() {
  return [path.join(os.homedir(), '.pi', 'agent'), SETTINGS_FILE(), USAGE_LEDGER_FILE()];
}

/** The keys the Settings dialog and the app itself write. `jobs` is deliberately absent. */
const SETTINGS_KEYS = new Set([
  'cwd',
  'serialQueue',
  'restoreTabs',
  'strataUrl',
  'strataUrls',
  'strataConfigPath',
  'monitorOpen',
  'monitorWidth',
  'sidebarHidden',
  'theme',
  'language',
  'firstRunSeen',
  'usagePrices',
  'openTabs',
]);

/** Split a renderer patch into what it may write and what it may not. */
function splitSettingsPatch(patch) {
  const allowed = {};
  const refused = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { allowed, refused: ['patch was not an object'] };
  for (const [key, value] of Object.entries(patch)) {
    if (SETTINGS_KEYS.has(key)) allowed[key] = value;
    else refused.push(key);
  }
  return { allowed, refused };
}

/* ------------------------------------------------------------------ */
/* D10: language (English / 繁體中文 / 简体中文)                        */
/* ------------------------------------------------------------------ */

/*
 * The English source string is the key, so main works with a translator object that is rebuilt whenever
 * the language changes. Catalogs are read here (the renderer has no fs) and handed over by IPC.
 * 'auto' follows the OS locale (app.getLocale()); the setting can pin a language instead.
 */
const catalogCache = new Map();
let trMain = i18n.makeT(null, 'en');
let i18nCurrent = { pref: 'auto', systemLocale: 'en', lang: 'en' };

function systemLocale() {
  try {
    return app.getLocale() || 'en';
  } catch {
    return 'en';
  }
}

function loadCatalog(lang) {
  if (catalogCache.has(lang)) return catalogCache.get(lang);
  let catalog = null;
  if (lang !== 'en') {
    const file = path.join(__dirname, 'locales', `${lang}.json`);
    try {
      catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`[i18n] catalog ${lang} did not load (${file}): ${err.message} - falling back to English`);
    }
  }
  catalogCache.set(lang, catalog);
  return catalog;
}

/** Re-resolve the language from the settings, load its catalog and rebuild the native menu. */
function applyLanguage() {
  const pref = (loadSettings().language || 'auto');
  i18nCurrent = { pref, systemLocale: systemLocale(), lang: i18n.resolveLanguage(pref, systemLocale()) };
  trMain = i18n.makeT(loadCatalog(i18nCurrent.lang), i18nCurrent.lang);
  // Electron 40 has no app.setLocale (only getLocale / getSystemLocale), so the few menu items that come
  // from Electron's own roles get an explicit translated label in buildMenu() instead; the --lang switch
  // set before ready is what moves Chromium's own locale (navigator.language, default date formatting).
  buildMenu();
  console.log(`[i18n] pref=${i18nCurrent.pref} system=${i18nCurrent.systemLocale} lang=${i18nCurrent.lang} entries=${trMain.size}`);
  return i18nCurrent;
}

/** main-side translate (menu, native dialogs, crash recovery) */
function tr(text, params) {
  return trMain.t(text, params);
}

function i18nPayload() {
  return {
    ...i18nCurrent,
    langs: i18n.LANGS,
    labels: i18n.LANG_LABELS,
    catalog: i18nCurrent.lang === 'en' ? {} : loadCatalog(i18nCurrent.lang) || {},
  };
}

/* ------------------------------------------------------------------ */
/* D9: token usage ledger (day buckets per session, for the usage chart) */
/* ------------------------------------------------------------------ */

let usageRefreshTimer = null;

/**
 * Re-scan the session files into the usage ledger, debounced. The scan is incremental - a session
 * file whose (mtime, size) did not change is never opened - so this is cheap; the debounce is only
 * about not writing the ledger while a run is finishing. `usage:series` refreshes by itself, so
 * opening the chart is always current.
 */
function scheduleUsageRefresh(delayMs = 5000) {
  clearTimeout(usageRefreshTimer);
  usageRefreshTimer = setTimeout(() => {
    // #10: refreshAsync, not refresh: this fires after every settled run, every compaction, every
    // window focus and every cleanup, and a synchronous walk of every session file blocks the window
    // messages that keep it answering input. refreshAsync yields between files and coalesces callers
    // into one scan.
    usageLedger
      .refreshAsync()
      .then((info) => {
        if (info.parsed || info.failed) {
          console.log(`[usage-ledger] parsed=${info.parsed} skipped=${info.skipped} entries=${info.entries} gone=${info.gone} failed=${info.failed} passes=${info.passes}`);
        }
      })
      .catch((err) => console.error(`[usage-ledger] refresh failed: ${err.stack || err}`));
  }, delayMs);
  if (usageRefreshTimer.unref) usageRefreshTimer.unref();
}

/** The ledger summary for the diagnostics report - a broken ledger must never break the report. */
function usageSummaryForReport() {
  try {
    return usageLedger.summary();
  } catch (err) {
    console.error(`[usage-ledger] summary for diagnostics failed: ${err.message}`);
    return null;
  }
}

/** Clamp what the renderer asks for into something safe to hand the ledger. */
function usageQuery(payload = {}) {
  const unit = ['day', 'week', 'month', 'year'].includes(payload && payload.unit) ? payload.unit : 'day';
  const limit = Number.isFinite(payload && payload.limit) ? Math.max(0, Math.min(400, Math.trunc(payload.limit))) : 0;
  return {
    unit,
    limit,
    fromMs: Number.isFinite(payload && payload.fromMs) ? payload.fromMs : null,
    toMs: Number.isFinite(payload && payload.toMs) ? payload.toMs : null,
    fill: !(payload && payload.fill === false),
  };
}

function send(channel, payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

/**
 * C5: the window / taskbar icon. Windows wants .ico, Linux the png; a checkout that has no build/
 * directory (or a packaged app whose resources moved) simply gets Electron's default instead of a
 * crash, which is why this is a function and not a constant.
 */
function appIconPath() {
  const candidates = process.platform === 'win32' ? ['build/icon.ico', 'build/icon.png'] : ['build/icon.png', 'build/icon.ico'];
  for (const rel of candidates) {
    const full = path.join(__dirname, rel);
    if (fs.existsSync(full)) return full;
  }
  return undefined;
}

function createWindow() {
  const settings = loadSettings();
  const bounds = settings.windowBounds || { width: 1360, height: 900 };
  win = new BrowserWindow({
    icon: appIconPath(),
    width: Math.max(900, bounds.width),
    height: Math.max(600, bounds.height),
    x: bounds.x,
    y: bounds.y,
    backgroundColor: '#0f1115',
    title: 'StrataPilot',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // #6: the preload only needs ipcRenderer / contextBridge / webUtils, all of which a sandboxed
      // preload has. Without this the renderer process has full Node-level capability if anything
      // ever gets code into it, which turns one bad string into read-the-config-then-ship-it-out.
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // links in chat output must never open extra Electron windows or navigate the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  if (process.env.STRATAPILOT_SMOKE) {
    console.log(`[smoke] window ${JSON.stringify(win.getBounds())}`);
  }

  win.webContents.on('console-message', (event) => {
    const level = Number(event.level) || 0;
    const message = event.message;
    const source = event.sourceId;
    const position = event.lineNumber ? `:${event.lineNumber}:${event.columnNumber}` : '';
    if (process.env.STRATAPILOT_SMOKE && level < 2) {
      console.log(`[renderer ${level}] ${message}`);
    } else if (level >= 2) {
      console.error(`[renderer ${level}] ${message} (${source}${position})`);
    }
  });

  // Renderer death is the usual shape of a "UI crash" (white window, or the window
  // vanishing). C8 records it; C9 recovers from it. Recovery is cheap because the pi
  // processes live in the main process and a tab's id is persisted in the settings, so a
  // reload re-attaches to the processes that are still alive instead of starting a second
  // pi per session.
  let unresponsiveReported = false;
  let recovering = false;

  const recoverInterface = async (cause, detail) => {
    if (recovering || !win || win.isDestroyed()) return;
    recovering = true;
    console.error(`[crash] recovery offered: ${cause} ${detail || ''}`);
    try {
      const choice = await dialog.showMessageBox(win, {
        type: 'error',
        title: 'StrataPilot',
        message: cause,
        detail:
          `${detail || ''}\n\n`
          + tr('Sessions are not closed: every pi session runs as its own process owned by the background process, and reloading the interface re-attaches to the ones that are still alive. A generation that was running right now is interrupted.')
          + `\n\n`
          + tr('The log file (Help \u25b8 Open Log Folder) holds what happened.'),
        buttons: [tr('Reload interface'), tr('Keep the window as it is')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice.response === 0) {
        console.log('[crash] reloading interface');
        win.webContents.reload();
      } else {
        console.log('[crash] reload declined by the user');
        send('recovery', { kind: 'declined', cause });
      }
    } catch (err) {
      console.error(`[crash] recovery dialog failed: ${err.message}`);
    } finally {
      recovering = false;
    }
  };

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      `[crash] renderer gone reason=${details.reason} exitCode=${details.exitCode} killed=${details.killed}`,
    );
    recoverInterface(tr('The interface stopped responding and was closed by Windows'), `reason=${details.reason} exitCode=${details.exitCode}`);
  });
  win.webContents.on('unresponsive', () => {
    console.error('[crash] renderer unresponsive (>30s of no reply)');
    unresponsiveReported = true;
    recoverInterface(tr('The interface has stopped responding'), tr('It has not answered for over 30 seconds \u2014 usually a stuck render, not a lost session.'));
  });
  win.webContents.on('responsive', () => {
    console.error('[crash] renderer responsive again');
    if (unresponsiveReported) {
      unresponsiveReported = false;
      send('recovery', { kind: 'recovered', cause: tr('The interface answered again \u2014 nothing was reloaded.') });
    }
  });
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[crash] preload-error ${preloadPath}: ${(error && error.stack) || error}`);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    if (errorCode === -3) return; // ABORTED: normal during reload/navigation
    console.error(`[nav] did-fail-load code=${errorCode} ${errorDescription} url=${validatedUrl}`);
    recoverInterface(tr('The interface failed to load'), `code=${errorCode} ${errorDescription}`);
  });

  if (process.env.STRATAPILOT_SMOKE) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        console.error('[smoke] quitting after startup window');
        app.quit();
      }, Number(process.env.STRATAPILOT_SMOKE_MS || 8000));
    });
  }
  win.on('close', () => {
    const bounds = win.getBounds();
    const next = loadSettings();
    next.windowBounds = bounds;
    saveSettings(next);
  });
  win.on('closed', () => {
    win = null;
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    {
      label: tr('Session'),
      submenu: [
        { label: tr('New Session'), accelerator: 'CmdOrCtrl+T', click: () => send('menu', 'new-session') },
        {
          label: tr('New Session In Current Tab'),
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => send('menu', 'reset-tab'),
        },
        { label: tr('Open Session…'), accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open-session') },
        { label: tr('Rename Session'), accelerator: 'F2', click: () => send('menu', 'rename-tab') },
        { type: 'separator' },
        { label: tr('Settings…'), accelerator: 'CmdOrCtrl+,', click: () => send('menu', 'settings') },
        { type: 'separator' },
        { label: tr('Close Tab'), accelerator: 'CmdOrCtrl+W', click: () => send('menu', 'close-tab') },
        { label: tr('Next Tab'), accelerator: 'CmdOrCtrl+Tab', click: () => send('menu', 'next-tab') },
        { label: tr('Previous Tab'), accelerator: 'CmdOrCtrl+Shift+Tab', click: () => send('menu', 'prev-tab') },
        { type: 'separator' },
        { role: isMac ? 'close' : 'quit', label: tr(isMac ? 'Close' : 'Quit') },
      ],
    },
    {
      label: tr('View'),
      submenu: [
        { label: tr('Toggle Sidebar'), accelerator: 'CmdOrCtrl+B', click: () => send('menu', 'toggle-sidebar') },
        { label: tr('Toggle Strata Monitor'), accelerator: 'CmdOrCtrl+M', click: () => send('menu', 'toggle-monitor') },
        { label: tr('Reload'), accelerator: 'CmdOrCtrl+R', click: () => win && win.webContents.reload() },
        { label: tr('DevTools'), accelerator: 'CmdOrCtrl+Shift+I', click: () => win && win.webContents.toggleDevTools() },
        { type: 'separator' },
        { role: 'zoomIn', label: tr('Zoom In') },
        { role: 'zoomOut', label: tr('Zoom Out') },
        { role: 'resetZoom', label: tr('Reset Zoom') },
      ],
    },
    {
      label: tr('Help'),
      submenu: [
        {
          label: tr('Open Log Folder'),
          click: () => {
            const dir = appLog.logDir();
            if (dir) shell.openPath(dir);
            else shell.openPath(app.getPath('userData'));
          },
        },
        {
          label: tr('First-run check'),
          click: () => send('first-run', {}),
        },
        {
          label: tr('Copy Diagnostics'),
          click: async () => {
            // same report the composer button produces; the menu path also puts it on the
            // clipboard straight from main, so it works even when the renderer is wedged
            const report = await buildDiagnostics({});
            clipboard.writeText(report.text);
            send('diagnostics', report);
          },
        },
        {
          label: tr('pi RPC docs'),
          click: () => shell.openExternal('https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/* pi process management                                               */
/* ------------------------------------------------------------------ */

function spawnTab({ tabId, cwd, args = [], env = {} }) {
  if (processes.has(tabId)) {
    const existing = processes.get(tabId);
    if (existing.alive) return { ok: true, reused: true };
    processes.delete(tabId);
  }
  // A session file can record a folder that no longer exists (project renamed/moved):
  // fall back to the app's saved cwd, then the home folder, instead of failing to spawn.
  let resolvedCwd = cwd;
  let cwdFallback = '';
  if (!resolvedCwd || !fs.existsSync(resolvedCwd)) {
    const saved = loadSettings().cwd;
    resolvedCwd = [saved, app.getPath('home'), process.cwd()].find((c) => c && fs.existsSync(c)) || process.cwd();
    cwdFallback = cwd || '(none)';
    console.log(`[spawn] tab=${tabId} cwd missing: ${cwdFallback} -> ${resolvedCwd}`);
  }
  const proc = new PiRpcProcess({ id: tabId, cwd: resolvedCwd, args, env });
  // D7: remember which session file this process owns, so a bulk cleanup refuses to delete a
  // session that is open in a tab (the file would keep being written to while deleted)
  {
    const flagIndex = args.findIndex((arg) => String(arg) === '--session');
    proc.sessionPath = flagIndex >= 0 && args[flagIndex + 1] ? String(args[flagIndex + 1]) : null;
  }

  proc.on('record', (record) => {
    send('pi:record', { tabId, record });
    // D9: a settled run - and a compaction, which is a model call of its own - is when new usage
    // lands in the session file, so the ledger follows without waiting for the process to exit
    if (record && (record.type === 'agent_settled' || record.type === 'compaction_end')) scheduleUsageRefresh(2500);
  });
  proc.on('stderr', (text) => {
    console.error(`[pi stderr tab=${tabId}] ${text.slice(0, 1000)}`);
    send('pi:stderr', { tabId, text: text.slice(0, 4000) });
  });
  proc.on('log', (text) => {
    console.log(`[pi log tab=${tabId}] ${text}`);
    send('pi:log', { tabId, text });
  });
  proc.on('exit', (info) => {
    // A tab's pi dying is often what the user perceives as "the UI crashed". A spawn failure
    // arrives here too, with code/signal null and `error` set - without that the line reads
    // `code=null signal=null` and the reason (ENOENT, EACCES) is nowhere in the log.
    console.error(
      `[pi exit tab=${tabId}] code=${info && info.code} signal=${info && info.signal}` +
        `${info && info.error ? ` error=${info.error}` : ''}` +
        `${info && info.droppedBytes ? ` droppedBytes=${info.droppedBytes} droppedRecords=${info.droppedRecords}` : ''}` +
        ` stderrTail=${JSON.stringify(String((info && info.stderr) || '').slice(-500))}`,
    );
    processes.delete(tabId);
    send('pi:exit', { tabId, ...info });
    // D9: a finished run is when new usage exists - refresh the rollup a little later so the write
    // does not compete with whatever the user is doing right now
    scheduleUsageRefresh();
  });

  try {
    proc.start();
  } catch (err) {
    console.error(`[pi spawn tab=${tabId}] failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
  processes.set(tabId, proc);
  console.log(`[pi spawn tab=${tabId}] ok cwd=${resolvedCwd} startupMs=${Date.now() - proc.startedAt}`);
  return { ok: true, cwd: resolvedCwd, cwdFallback, startupMs: Date.now() - proc.startedAt };
}

/* ------------------------------------------------------------------ */
/* scheduled prompts (B5)                                             */
/* ------------------------------------------------------------------ */

/**
 * The scheduler deliberately lives in the main process (it must keep running while the renderer is
 * reloading), but it never runs a prompt itself: firing a prompt from here would create a second
 * path into Strata next to the renderer's serial queue, and Strata answers one request at a time.
 * So a due job only sends a `cron:fire` event; the renderer pushes the text into the target tab's
 * outbox and lets the existing queue do the work.
 *
 * Job shape (persisted in settings.jobs[]):
 *   { id, name, schedule, prompt, target, cwd, ephemeral, enabled, createdAt, lastRun, nextRun }
 *   target: "new-tab" | "tab:<id>" | "session:<path>"
 */
const CRON_TICK_MS = 30 * 1000;
// a job whose time passed by more than this is reported as missed, not fired late: waking a laptop
// at 11:00 must not replay the 09:30 run
const CRON_GRACE_MS = 2 * 60 * 1000;

let cronTimer = null;
/** key -> { jobId, name, firedAt, timer } for fires still waiting for a renderer ack. (#9) */
const pendingFires = new Map();

function jobList() {
  const jobs = loadSettings().jobs;
  return Array.isArray(jobs) ? jobs : [];
}

function saveJobs(jobs) {
  const next = loadSettings();
  next.jobs = jobs;
  saveSettings(next);
}

/** Recompute every job's nextRun; report the runs that were slept through instead of firing them. */
function cronRecompute(reason) {
  const now = new Date();
  const jobs = jobList();
  const missed = [];
  const invalid = [];
  for (const job of jobs) {
    if (!job.enabled) {
      job.nextRun = null;
      continue;
    }
    let next = null;
    try {
      next = cron.nextRun(job.schedule, now);
    } catch (err) {
      invalid.push({ id: job.id, name: job.name || job.schedule, error: err.message });
      job.nextRun = null;
      continue;
    }
    const stored = job.nextRun ? Date.parse(job.nextRun) : NaN;
    if (Number.isFinite(stored) && stored < now.getTime() - CRON_GRACE_MS) {
      missed.push({ id: job.id, name: job.name || job.schedule, scheduled: job.nextRun });
    }
    job.nextRun = next ? next.toISOString() : null;
  }
  saveJobs(jobs);
  if (missed.length) {
    console.log(`[cron] ${reason}: ${missed.length} run(s) missed while asleep: ${missed.map((m) => `${m.name}@${m.scheduled}`).join(', ')}`);
    send('cron:notice', { kind: 'missed', jobs: missed, reason });
  }
  if (invalid.length) {
    console.error(`[cron] ${reason}: invalid schedule(s): ${invalid.map((i) => `${i.name}: ${i.error}`).join(' | ')}`);
    send('cron:notice', { kind: 'invalid', jobs: invalid, reason });
  }
  console.log(`[cron] ${reason}: armed ${jobs.filter((j) => j.enabled && j.nextRun).length} job(s)`);
}

function cronTick() {
  const now = new Date();
  const jobs = jobList();
  for (const job of jobs) {
    if (!job.enabled || !job.nextRun) continue;
    const due = Date.parse(job.nextRun);
    if (!Number.isFinite(due) || due > now.getTime()) continue;
    if (now.getTime() - due > CRON_GRACE_MS) continue; // handled by cronRecompute as "missed"
    fireJob(job, now, { manual: false });
  }
}

/**
 * Announce a due job and wait for the renderer to accept it. Nothing is written to the job until the
 * ack arrives: `send()` drops the event silently when the window is gone or reloading, and the old
 * code marked the run as done in the same tick, so a fire during a C9 window reload was lost while
 * the log said it ran. (#9)
 */
function fireJob(job, firedAt, { manual }) {
  const firedAtIso = firedAt.toISOString();
  if (!win || win.isDestroyed()) {
    // nobody can accept the prompt: report it now rather than pretending it ran
    console.log(`[cron] NOT firing "${job.name || job.schedule}": no window to accept the prompt`);
    send('cron:notice', { kind: 'undelivered', jobs: [{ id: job.id, name: job.name || job.schedule, scheduled: job.nextRun }], reason: 'no window' });
    const jobs = jobList();
    const target = jobs.find((entry) => entry.id === job.id);
    if (target) {
      const rearmed = cron.rearmAfterUnackedFire(target, firedAt);
      Object.assign(target, rearmed);
      saveJobs(jobs);
    }
    return { ok: false, error: 'no window to accept the prompt' };
  }
  console.log(`[cron] firing "${job.name || job.schedule}" (${job.schedule}) target=${job.target || 'new-tab'} waiting for ack`);
  const key = cron.fireKey(job.id, firedAtIso);
  const timer = setTimeout(() => {
    if (!pendingFires.delete(key)) return;
    // leave lastRun alone and report it: the run did not happen, and saying so is cheaper than a
    // user finding out from a transcript that was never written
    console.log(`[cron] no ack for "${job.name || job.schedule}" after ${cron.CRON_ACK_MS}ms: the run did not happen`);
    const jobs = jobList();
    const target = jobs.find((entry) => entry.id === job.id);
    if (target) {
      Object.assign(target, cron.rearmAfterUnackedFire(target, new Date()));
      saveJobs(jobs);
    }
    send('cron:notice', { kind: 'undelivered', jobs: [{ id: job.id, name: job.name || job.schedule, scheduled: firedAtIso }], reason: 'no ack' });
  }, cron.CRON_ACK_MS);
  timer.unref?.();
  pendingFires.set(key, { jobId: job.id, name: job.name || job.schedule, firedAt: firedAtIso, timer });
  send('cron:fire', { job, firedAt: firedAtIso, manual, key });
  return { ok: true, pending: true, key };
}

/** The renderer accepted the prompt into a tab's outbox: now the run counts. */
function cronAck(key) {
  const entry = pendingFires.get(key);
  if (!entry) return { ok: false, error: 'no such pending fire' };
  clearTimeout(entry.timer);
  pendingFires.delete(key);
  const jobs = jobList();
  const job = jobs.find((entry2) => entry2.id === entry.jobId);
  if (!job) return { ok: false, error: 'no such job' };
  Object.assign(job, cron.commitFire(job, entry.firedAt, new Date()));
  saveJobs(jobs);
  console.log(`[cron] acked "${entry.name}"; lastRun=${job.lastRun} next=${job.nextRun || '(none)'}`);
  return { ok: true, lastRun: job.lastRun, nextRun: job.nextRun };
}

function cronStart() {
  cronRecompute('startup');
  clearInterval(cronTimer);
  cronTimer = setInterval(cronTick, CRON_TICK_MS);
  console.log(`[cron] ticking every ${CRON_TICK_MS / 1000}s (grace ${CRON_GRACE_MS / 1000}s)`);
}

function cronStop() {
  clearInterval(cronTimer);
  cronTimer = null;
}

/** Validate what the Jobs dialog sends; returns the sanitised list or throws with a clear message. */
function sanitizeJobs(input) {
  if (!Array.isArray(input)) throw new Error('jobs must be a list');
  const out = [];
  input.forEach((job, index) => {
    const source = job && typeof job === 'object' ? job : {};
    const schedule = String(source.schedule || '').trim();
    const prompt = String(source.prompt || '').trim();
    if (!schedule) throw new Error(`job ${index + 1}: schedule is empty`);
    if (!cron.isValidCron(schedule)) {
      throw new Error(`job ${index + 1}: "${schedule}" is not a 5-field cron expression (${cron.parseCron.name}: minute hour day month weekday)`);
    }
    if (!prompt) throw new Error(`job ${index + 1}: prompt is empty`);
    const target = String(source.target || 'new-tab').trim();
    if (!['new-tab', 'tab:', 'session:'].some((prefix) => target === 'new-tab' || target.startsWith(prefix))) {
      throw new Error(`job ${index + 1}: target must be new-tab, tab:<id> or session:<path>`);
    }
    out.push({
      id: String(source.id || `job-${Date.now().toString(36)}-${index}`),
      name: String(source.name || '').trim() || schedule,
      schedule,
      prompt,
      target,
      cwd: String(source.cwd || '').trim(),
      ephemeral: !!source.ephemeral,
      enabled: source.enabled !== false,
      createdAt: source.createdAt || new Date().toISOString(),
      lastRun: source.lastRun || null,
      nextRun: null,
    });
  });
  return out;
}

/**
 * `http://host/v1` + `/metrics` -> `http://host/metrics`, the way the Monitor has always built it.
 * Returning null is what the handlers report as "invalid base url".
 */
function buildTargetUrl(baseUrl, suffix) {
  const trimmed = String(baseUrl == null ? '' : baseUrl).trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  if (!trimmed) return null;
  try {
    return new URL(`${trimmed}${suffix}`);
  } catch {
    return null;
  }
}

/**
 * #6: the key only travels to a local/LAN address or to a server the user configured. A withheld key
 * is logged, never silently dropped - the Monitor shows "key withheld" so the user can add the server.
 */
function strataKeyFor(target, rendererKey) {
  const configured = String(rendererKey || process.env.STRATAPILOT_KEY || process.env.STRATA_API_KEY || '');
  const decision = netPolicy.keyForHost(target, netPolicy.allowlistFrom(loadSettings()), configured);
  if (decision.withheld) console.log(`[strata] key withheld for ${target.host}: ${decision.reason}`);
  return decision;
}

/* ------------------------------------------------------------------ */
/* diagnostics report (A6: "Copy diagnostics")                        */
/* ------------------------------------------------------------------ */

/** GET a URL and return { ok, text } — the raw body, so /health can be quoted verbatim. */
async function fetchText(url, { apiKey = '', timeoutMs = 4000 } = {}) {  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = (await response.text()).slice(0, 4000);
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}: ${body}`, url };
    return { ok: true, text: body, url };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message, url };
  } finally {
    clearTimeout(timer);
  }
}

function oneLineJson(text) {
  if (!text) return '';
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 600);
}

/**
 * Assemble the report asked for by docs/TROUBLESHOOTING.md. The renderer passes its queue
 * snapshot and the Strata address it derived from the active tab; everything else (paths,
 * config files, the log tail) belongs to the main process. Secrets are stripped by
 * lib/diagnostics.js before the text reaches the clipboard or the file on disk.
 */
async function buildDiagnostics(payload = {}) {
  const inv = resolvePiInvocation();
  const settings = loadSettings();
  const agentDir = path.join(os.homedir(), '.pi', 'agent');
  const baseUrl = String(payload.baseUrl || settings.strataUrl || '').replace(/\/v1\/?$/i, '').replace(/\/+$/, '');

  const strata = { baseUrl: baseUrl || tr('(none: no tab with a model, and no strataUrl setting)') };
  if (baseUrl) {
    const healthTarget = buildTargetUrl(baseUrl, '/health');
    const modelsTarget = buildTargetUrl(baseUrl, '/v1/models');
    const policy = netPolicy.urlPolicy(healthTarget);
    if (!policy.ok) {
      strata.healthText = policy.error;
      strata.modelsText = policy.error;
    } else {
      const useKey = strataKeyFor(healthTarget, payload.apiKey);
      strata.keyWithheld = useKey.withheld;
      const health = await fetchText(healthTarget.href, { apiKey: useKey.key });
      strata.healthText = health.ok ? oneLineJson(health.text) : health.error;
      const models = await fetchText(modelsTarget.href, { apiKey: useKey.key });
      strata.modelsText = models.ok ? oneLineJson(models.text) : models.error;
    }
    strata.metricsUrl = `${baseUrl}/metrics`;
  }
  strata.engineConfig = diagnostics.readConfig(settings.strataConfigPath || '');
  if (!settings.strataConfigPath) strata.engineConfig.error = 'settings.strataConfigPath is not set (Settings dialog ▸ Strata config)';

  const data = {
    app: {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      platform: `${process.platform}/${process.arch}`,
      logPath: appLog.logPath(),
      settingsPath: SETTINGS_FILE(),
      sessionsRoot: sessions.sessionsRoot(),
      defaultCwd: process.cwd(),
    },
    pi: {
      cliPath: inv.cliPath,
      nodePath: inv.nodePath,
      runAsNode: inv.runAsNode,
      piVersion: inv.piVersion,
      testedVersion: TESTED_PI_VERSION,
      sessionsRoot: sessions.sessionsRoot(),
      settingsFile: path.join(agentDir, 'settings.json'),
      defaultModel: diagnostics.readConfig(path.join(agentDir, 'settings.json')),
      modelsJson: diagnostics.readConfig(path.join(agentDir, 'models.json')),
    },
    strata,
    queue: {
      serial: schedulerStateSnapshot(payload),
      active: payload.active || '',
      rows: Array.isArray(payload.rows) ? payload.rows : [],
    },
    log: diagnostics.tail(appLog.logPath()),
    usage: usageSummaryForReport(),
    // the rates are the other half of a "the money looks wrong" report - they live in settings, not in
    // the ledger, so the report has to carry them separately
    usageRates: settings.usagePrices || null,
  };

  const text = diagnostics.format(data);
  let savedTo = '';
  try {
    const dir = path.join(app.getPath('userData'), 'diagnostics');
    fs.mkdirSync(dir, { recursive: true });
    savedTo = path.join(dir, `stratapilot_diagnostics_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    fs.writeFileSync(savedTo, text, 'utf8');
    pruneDiagnosticsReports(dir);
  } catch (err) {
    console.error(`[diagnostics] could not save report: ${err.message}`);
  }
  console.log(`[diagnostics] report built lines=${text.split('\n').length} saved=${savedTo}`);
  return { ok: true, text, path: savedTo };
}

/**
 * Every "Copy diagnostics" click wrote a new timestamped report into userData/diagnostics and
 * nothing ever removed it (#13). The names sort lexicographically = chronologically (ISO timestamp
 * with the colons replaced), so keeping the newest N is a sort and an unlink.
 */
const MAX_DIAGNOSTICS_REPORTS = 20;

function pruneDiagnosticsReports(dir) {
  let removed = 0;
  try {
    const names = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith('stratapilot_diagnostics_') && name.endsWith('.txt'))
      .sort();
    for (const name of names.slice(0, Math.max(0, names.length - MAX_DIAGNOSTICS_REPORTS))) {
      try {
        fs.unlinkSync(path.join(dir, name));
        removed += 1;
      } catch {}
    }
  } catch (err) {
    console.error(`[diagnostics] prune failed: ${err.message}`);
  }
  if (removed) console.log(`[diagnostics] pruned ${removed} old report(s), keeping ${MAX_DIAGNOSTICS_REPORTS}`);
  return removed;
}

function schedulerStateSnapshot(payload) {
  if (typeof payload.serial === 'boolean') return payload.serial;
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('app:info', () => {
    const inv = resolvePiInvocation();
    return {
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      // STRATAPILOT_SMOKE_PI_VERSION fakes the reported pi version so the version guard (C6)
      // can be exercised without installing a different pi
      piVersion: process.env.STRATAPILOT_SMOKE_PI_VERSION || inv.piVersion,
      testedPiVersion: TESTED_PI_VERSION,
      piVersionLevel: piVersionStatus(process.env.STRATAPILOT_SMOKE_PI_VERSION || inv.piVersion, TESTED_PI_VERSION).level,
      cliPath: inv.cliPath,
      nodePath: inv.nodePath,
      runAsNode: inv.runAsNode,
      sessionsRoot: sessions.sessionsRoot(),
      logPath: appLog.logPath(),
      settingsPath: SETTINGS_FILE(),
      defaultCwd: process.cwd(),
      home: os.homedir(),
      smoke: !!process.env.STRATAPILOT_SMOKE,
      smokePrompt: process.env.STRATAPILOT_SMOKE_PROMPT || '',
      smokeSession: process.env.STRATAPILOT_SMOKE_SESSION || '',
      smokeSteer: !!process.env.STRATAPILOT_SMOKE_STEER,
      smokeQueue: !!process.env.STRATAPILOT_SMOKE_QUEUE,
      smokeMonitor: !!process.env.STRATAPILOT_SMOKE_MONITOR,
      smokeCompact: !!process.env.STRATAPILOT_SMOKE_COMPACT,
      smokeOrder: !!process.env.STRATAPILOT_SMOKE_ORDER,
      smokeAutoCompact: !!process.env.STRATAPILOT_SMOKE_AUTO_COMPACT,
      smokeBash: !!process.env.STRATAPILOT_SMOKE_BASH,
      smokeBars: !!process.env.STRATAPILOT_SMOKE_BARS,
      smokePaste: !!process.env.STRATAPILOT_SMOKE_PASTE,
      smokeCopy: !!process.env.STRATAPILOT_SMOKE_COPY,
      smokeExport: !!process.env.STRATAPILOT_SMOKE_EXPORT,
      smokeExportOut: process.env.STRATAPILOT_SMOKE_EXPORT_OUT || path.join(os.tmpdir(), 'stratapilot_smoke_export.html'),
      smokeDiag: !!process.env.STRATAPILOT_SMOKE_DIAG,
      smokeSettings: !!process.env.STRATAPILOT_SMOKE_SETTINGS,
      smokeRetry: !!process.env.STRATAPILOT_SMOKE_RETRY,
      smokeOutbox: !!process.env.STRATAPILOT_SMOKE_OUTBOX,
      smokeCron: !!process.env.STRATAPILOT_SMOKE_CRON,
      smokeTabTag: !!process.env.STRATAPILOT_SMOKE_TABTAG,
      smokeTheme: !!process.env.STRATAPILOT_SMOKE_THEME,
      smokeA11y: !!process.env.STRATAPILOT_SMOKE_A11Y,
      smokeUsage: !!process.env.STRATAPILOT_SMOKE_USAGE,
      smokeI18n: !!process.env.STRATAPILOT_SMOKE_I18N,
      smokeStorage: !!process.env.STRATAPILOT_SMOKE_STORAGE,
      smokeServers: !!process.env.STRATAPILOT_SMOKE_SERVERS,
      smokePath: !!process.env.STRATAPILOT_SMOKE_PATH,
      smokeTree: !!process.env.STRATAPILOT_SMOKE_TREE,
      smokeFork: !!process.env.STRATAPILOT_SMOKE_FORK,
      smokeSetup: !!process.env.STRATAPILOT_SMOKE_SETUP,
    };
  });

  ipcMain.handle('cron:list', () => ({
    ok: true,
    // description: the same human sentence the editor previews, so the job list can say
    // "every weekday, at 09:30" instead of making the user decode "30 9 * * 1-5"
    jobs: jobList().map((job) => {
      try {
        return { ...job, description: cron.describeCron(job.schedule) };
      } catch {
        return { ...job, description: '' };
      }
    }),
    now: new Date().toISOString(),
  }));

  ipcMain.handle('cron:save', (_event, { jobs } = {}) => {
    try {
      const clean = sanitizeJobs(jobs);
      saveJobs(clean);
      cronRecompute('saved');
      console.log(`[cron] saved ${clean.length} job(s) from the dialog`);
      return { ok: true, jobs: jobList() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /** Preview in the editor: is the expression valid, what does it mean, when does it next fire. */
  ipcMain.handle('cron:preview', (_event, { schedule } = {}) => {
    try {
      const next = cron.nextRun(schedule, new Date());
      return {
        ok: true,
        valid: true,
        description: cron.describeCron(schedule),
        preset: cron.schedulePreset(schedule),
        nextRun: next ? next.toISOString() : null,
      };
    } catch (err) {
      return { ok: true, valid: false, error: err.message };
    }
  });

  /** Fire a job immediately (the Jobs dialog has a "run now" button for testing a prompt). */
  ipcMain.handle('cron:run-now', (_event, { id } = {}) => {
    const job = jobList().find((entry) => entry.id === id);
    if (!job) return { ok: false, error: 'no such job' };
    const result = fireJob(job, new Date(), { manual: true });
    // #9: this used to answer { ok: true } without the job having been queued anywhere; the button
    // now reports whether the renderer is even there to take the prompt
    return result;
  });

  ipcMain.on('cron:ack', (_event, { key } = {}) => {
    const result = cronAck(String(key || ''));
    if (!result.ok) console.log(`[cron] ack refused (${key}): ${result.error}`);
  });

    // Smoke-only: lets a scenario take a screenshot (theme checks, layout checks). Never registered
  // outside smoke mode.
  if (process.env.STRATAPILOT_SMOKE) {
    ipcMain.handle('app:smoke-shot', async (event, payload) => {
      // the window that asked is usually gone exactly when a scenario is already going wrong, and
      // the fallback used to read `win()` while a local `const win` shadowed the module-level
      // `let win` - a TDZ ReferenceError, so the one path meant to report a broken scenario threw
      // instead. See lib/smoke-shot.js and test/smoke-shot.test.js.
      const target = resolveCaptureTarget(BrowserWindow.fromWebContents(event.sender), win);
      if (!target) return { ok: false, error: 'no window to capture' };
      const name = String((payload && payload.name) || 'shot').replace(/[^a-z0-9_-]/gi, '');
      try {
        const image = await target.webContents.capturePage();
        const file = path.join(os.tmpdir(), `stratapilot-smoke-${name}.png`);
        fs.writeFileSync(file, image.toPNG());
        console.log(`[smoke-shot] wrote ${file} bounds=${JSON.stringify(target.getContentBounds())}`);
        return { ok: true, file };
      } catch (err) {
        console.error(`[smoke-shot] failed: ${err.stack || err}`);
        return { ok: false, error: err.message };
      }
    });
  }

  ipcMain.handle('app:diagnostics', async (_event, payload) => buildDiagnostics(payload && typeof payload === 'object' ? payload : {}));

  ipcMain.handle('app:settings-get', () => loadSettings());

  // D10: the renderer asks for the active language + its catalog at boot, and after a change from the
  // Settings dialog. The catalog is a plain { english: translation } object; 'en' sends an empty one
  // because English is the key and needs no lookup.
  ipcMain.handle('i18n:get', () => i18nPayload());
  ipcMain.handle('i18n:set', (_event, { language } = {}) => {
    const next = loadSettings();
    next.language = language || 'auto';
    saveSettings(next);
    applyLanguage();
    return i18nPayload();
  });
  ipcMain.handle('app:settings-set', (_event, patch) => {
    // #6: this used to be `{ ...loadSettings(), ...patch }` with no key whitelist, so a compromised
    // renderer could rewrite strataUrls (the key allowlist), openTabs, or jobs - bypassing
    // sanitizeJobs() entirely and arming a prompt to fire on a schedule. Anything not on the list is
    // refused and logged; `jobs` is only reachable through cron:save + sanitizeJobs().
    const { allowed, refused } = splitSettingsPatch(patch);
    if (refused.length) console.log(`[settings] refused key(s): ${refused.join(', ')}`);
    const merged = { ...loadSettings(), ...allowed };
    saveSettings(merged);
    return merged;
  });

  ipcMain.handle('pi:spawn', (_event, payload) => spawnTab(payload || {}));

  // renderer window.onerror / onunhandledrejection (see renderer/app.js)
  ipcMain.on('app:client-error', (_event, entry) => {
    const safe = entry && typeof entry === 'object' ? entry : {};
    console.error(
      `[renderer error] ${safe.type || 'error'}: ${safe.message || '(no message)'} ` +
        `${safe.source || ''}${safe.line ? `:${safe.line}:${safe.column}` : ''}\n${safe.stack || '(no stack)'}`,
    );
  });

  ipcMain.handle('pi:cmd', async (_event, { tabId, type, fields = {}, timeoutMs }) => {
    const proc = processes.get(tabId);
    if (!proc || !proc.alive) {
      return { type: 'response', command: type, success: false, error: 'session process is not running' };
    }
    return proc.command(type, fields, timeoutMs);
  });

  ipcMain.handle('pi:ui-response', (_event, { tabId, response }) => {
    const proc = processes.get(tabId);
    if (!proc) return { ok: false };
    proc.respondUi(response);
    return { ok: true };
  });

  ipcMain.handle('pi:dispose', (_event, { tabId }) => {
    const proc = processes.get(tabId);
    if (proc) {
      processes.delete(tabId);
      proc.dispose();
    }
    return { ok: true };
  });

  ipcMain.handle('pi:alive', (_event, { tabIds = [] }) => {
    const out = {};
    for (const tabId of tabIds) out[tabId] = processes.has(tabId);
    return out;
  });

  ipcMain.handle('sessions:list', (_event, payload) => {
    try {
      return { ok: true, ...sessions.listSessions(payload || {}) };
    } catch (err) {
      return { ok: false, error: err.message, sessions: [] };
    }
  });

  ipcMain.handle('sessions:read', (_event, { sessionPath }) => {
    try {
      return { ok: true, meta: sessions.readSessionMeta(sessionPath) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('sessions:delete', (_event, { sessionPath }) => {
    try {
      return { ok: sessions.deleteSession(sessionPath) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('sessions:rename', (_event, { sessionPath, name }) => {
    try {
      return { ok: true, meta: sessions.renameSession(sessionPath, name) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // D7: the renderer switches sessions with the switch_session RPC, which the main process does not
  // see - without this a tab that switched would keep the path it was spawned with, and a cleanup
  // could delete the file its own process is writing to
  ipcMain.handle('pi:session-path', (_event, { tabId, sessionPath } = {}) => {
    const proc = processes.get(tabId);
    if (!proc) return { ok: false, error: 'no process for that tab' };
    proc.sessionPath = sessionPath || null;
    return { ok: true };
  });

  /* D7: session storage usage and bulk cleanup */
  ipcMain.handle('sessions:stats', () => {
    try {
      const stats = sessions.storageStats();
      // the IPC payload stays small: a group with thousands of files only needs its biggest ones here,
      // the totals are what the sidebar footer shows and the plan endpoint returns full lists
      const ENTRY_CAP = 400;
      return {
        ok: true,
        root: stats.root,
        totalBytes: stats.totalBytes,
        totalFiles: stats.totalFiles,
        groups: stats.groups.map((group) => ({
          group: group.group,
          dir: group.dir,
          files: group.files,
          bytes: group.bytes,
          newestMs: group.newestMs,
          oldestMs: group.oldestMs,
          entries: group.entries.slice(0, ENTRY_CAP),
          entriesTruncated: Math.max(0, group.entries.length - ENTRY_CAP),
        })),
      };
    } catch (err) {
      console.error(`[sessions:stats] failed: ${err.stack || err}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('sessions:cleanup-plan', (_event, payload) => {
    try {
      const plan = sessions.cleanupPlan({
        olderThanDays: Number.isFinite(payload && payload.olderThanDays) ? payload.olderThanDays : null,
        keepNewestPerGroup: Number.isFinite(payload && payload.keepNewestPerGroup) ? payload.keepNewestPerGroup : null,
      });
      const open = openSessionPaths();
      plan.candidates = plan.candidates.filter((entry) => {
        entry.openInTab = open.has(path.resolve(entry.path));
        return !entry.openInTab;
      });
      plan.bytes = plan.candidates.reduce((sum, entry) => sum + entry.bytes, 0);
      plan.openSkipped = open.size;
      return { ok: true, ...plan };
    } catch (err) {
      console.error(`[sessions:cleanup-plan] failed: ${err.stack || err}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('sessions:cleanup-run', (_event, payload) => {
    try {
      const paths = Array.isArray(payload && payload.paths) ? payload.paths : [];
      const result = sessions.deleteSessions(paths, { skip: openSessionPaths() });
      console.log(`[sessions:cleanup] requested=${paths.length} deleted=${result.deleted} bytes=${result.bytes} skipped_open=${result.skipped.length} failed=${result.failed.length}`);
      if (result.deleted) scheduleUsageRefresh(0); // the ledger marks those entries as gone
      return { ok: true, ...result };
    } catch (err) {
      console.error(`[sessions:cleanup-run] failed: ${err.stack || err}`);
      return { ok: false, error: err.message };
    }
  });

  /* D9: token usage rollup - the chart in the Usage dialog reads through these */
  ipcMain.handle('usage:series', async (_event, payload) => {
    try {
      // incremental: only files that changed since the last scan. Awaited, and the scan yields between
      // files, so opening the chart on a folder of thousands of sessions cannot freeze the window (#10)
      const scan = await usageLedger.refreshAsync();
      const report = usageLedger.series(usageQuery(payload));
      return { ok: true, scan, ...report };
    } catch (err) {
      console.error(`[usage:series] failed: ${err.stack || err}`);
      return { ok: false, error: err.message, buckets: [], totals: null, models: [] };
    }
  });

  ipcMain.handle('usage:summary', async () => {
    try {
      // incremental scan first: the footer chip asks after every settled run and every window focus,
      // and answering from a stale ledger file is exactly what made the number look like it needed an
      // app restart to update. Concurrent callers share one scan instead of starting one each (#10)
      await usageLedger.refreshAsync();
      return { ok: true, ...usageLedger.summary() };
    } catch (err) {
      console.error(`[usage:summary] failed: ${err.stack || err}`);
      return { ok: false, error: err.message };
    }
  });

  /** "Recount from the files on disk": drop the entries of sessions that no longer exist. */
  ipcMain.handle('usage:recount', () => {
    try {
      const info = usageLedger.recount();
      console.log(`[usage-ledger] recount dropped_gone=${info.droppedGone} parsed=${info.parsed} entries=${info.entries}`);
      return { ok: true, ...info, ...usageLedger.summary() };
    } catch (err) {
      console.error(`[usage:recount] failed: ${err.stack || err}`);
      return { ok: false, error: err.message };
    }
  });

  /** Session files currently owned by a live pi process - a cleanup must not delete those. */
  function openSessionPaths() {
    const out = new Set();
    for (const proc of processes.values()) {
      if (proc && proc.alive && proc.sessionPath) out.add(path.resolve(proc.sessionPath));
    }
    return out;
  }

  ipcMain.handle('fs:choose-folder', async () => {
    if (!win) return { ok: false };
    const result = await dialog.showOpenDialog(win, {
      title: tr('Choose a working folder'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };
    noteChosen(result.filePaths[0]);
    return { ok: true, path: result.filePaths[0] };
  });


  // D1: `@path` completion in the composer. Only the folder part of the fragment is listed, and only
  // inside the session's own working folder - the composer is not a file browser.
  ipcMain.handle('fs:complete', (_event, { cwd, fragment = '' } = {}) => {
    const base = cwd && fs.existsSync(cwd) ? cwd : process.cwd();
    const cleaned = String(fragment).replace(/\/+$/g, '').replace(/\\/g, '/');
    const lastSlash = cleaned.lastIndexOf('/');
    const dirPart = lastSlash >= 0 ? cleaned.slice(0, lastSlash) : '';
    const prefix = (lastSlash >= 0 ? cleaned.slice(lastSlash + 1) : cleaned).toLowerCase();
    const dir = path.resolve(base, dirPart || '.');
    const rel = path.relative(base, dir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, error: 'outside the session folder' };
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return { ok: false, error: err.code === 'ENOENT' ? 'no such folder' : err.message };
    }
    // noise that nobody wants to page through, unless they typed it on purpose
    const NOISE = ['node_modules', '.git', '.venv', '__pycache__', 'dist', 'build', 'out', '.next', '.cache'];
    const typedNoise = dirPart.toLowerCase().split('/').some((part) => NOISE.includes(part));
    const out = [];
    for (const entry of entries) {
      if (!entry.isFile() && !entry.isDirectory()) continue;
      if (!typedNoise && NOISE.includes(entry.name.toLowerCase())) continue;
      if (prefix && !entry.name.toLowerCase().startsWith(prefix)) continue;
      out.push({ name: entry.name, isDirectory: entry.isDirectory(), path: `${dirPart ? `${dirPart}/` : ''}${entry.name}` });
    }
    out.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
    return { ok: true, dir: dirPart, prefix, entries: out.slice(0, 40), total: out.length };
  });
  ipcMain.handle('fs:choose-file', async (_event, { title = 'Choose a file', filters = null } = {}) => {
    if (!win) return { ok: false };
    const result = await dialog.showOpenDialog(win, {
      title: tr(title),
      properties: ['openFile'],
      ...(Array.isArray(filters) && filters.length ? { filters } : {}),
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };
    noteChosen(result.filePaths[0]);
    return { ok: true, path: result.filePaths[0] };
  });

  // Plain dialog wrapper only: the renderer never writes through this, pi's export_html
  // does the writing. Cancelling is a normal outcome (cancelled:true), not an error.
  ipcMain.handle('fs:save-file', async (_event, { defaultPath = '', title = 'Save file' } = {}) => {
    if (!win) return { ok: false };
    const result = await dialog.showSaveDialog(win, {
      title: tr(title),
      defaultPath,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle('fs:stat-paths', (_event, { paths: items = [] }) => {
    // drag & drop stats files from anywhere the user dropped them from, so this stays open apart
    // from the credential-bearing paths - but the renderer does not decide how many paths one call
    // may ask for
    const asked = Array.isArray(items) ? items.slice(0, 50) : [];
    if (Array.isArray(items) && items.length > asked.length) {
      console.log(`[fs] stat-paths truncated ${items.length} -> ${asked.length}`);
    }
    return asked.map((item) => {
      const guard = fsGuard.statAllowed(String(item || ''), { denied: deniedStatPaths() });
      if (!guard.ok) {
        console.log(`[fs] stat refused: ${guard.path}`);
        return { path: String(item), name: path.basename(String(item)), error: guard.error, refused: true };
      }
      try {
        const stat = fs.statSync(guard.path);
        return {
          path: guard.path,
          name: path.basename(guard.path),
          dir: path.dirname(guard.path),
          size: stat.size,
          isDirectory: stat.isDirectory(),
          ext: path.extname(guard.path).toLowerCase(),
        };
      } catch (err) {
        return { path: String(item), name: path.basename(String(item)), error: err.message };
      }
    });
  });

  ipcMain.handle('fs:read-text', (_event, { filePath, maxBytes = 200000 }) => {
    // #6: this used to read ANY absolute path the renderer named, with the cap supplied by the
    // caller - ~/.pi/agent/settings.json and models.json (which hold the Strata key) were one call
    // away. The preload binding is gone too, so the renderer has no way to reach this at all; the
    // guard stays as defence in depth for any future caller.
    const guard = fsGuard.readAllowed(String(filePath || ''), { roots: readRoots() });
    if (!guard.ok) {
      console.log(`[fs] read refused: ${guard.path}`);
      return { ok: false, error: guard.error, refused: true };
    }
    try {
      const stat = fs.statSync(guard.path);
      if (stat.isDirectory()) return { ok: false, error: 'is a directory' };
      const cap = Math.min(Math.max(Number(maxBytes) || 0, 0), 2000000);
      if (stat.size > cap) return { ok: false, error: `file larger than ${cap} bytes`, tooLarge: true };
      return { ok: true, text: fs.readFileSync(guard.path, 'utf8'), size: stat.size };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('strata:metrics', async (_event, { baseUrl, all = false, apiKey = '', timeoutMs = 4000 } = {}) => {
    if (!baseUrl) return { ok: false, error: 'no base url' };
    const target = buildTargetUrl(baseUrl, `/metrics${all ? '?requests=all' : ''}`);
    const policy = netPolicy.urlPolicy(target);
    if (!policy.ok) return { ok: false, error: policy.error, url: target ? target.href : String(baseUrl) };
    const useKey = strataKeyFor(target, apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetch(target, {
        headers: { accept: 'application/json', ...(useKey.key ? { authorization: `Bearer ${useKey.key}` } : {}) },
        cache: 'no-store',
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, status: response.status, url: target.href, keyWithheld: useKey.withheld };
      try {
        return { ok: true, url: target.href, data: JSON.parse(text), keyWithheld: useKey.withheld };
      } catch {
        return { ok: false, error: 'response was not JSON', url: target.href, keyWithheld: useKey.withheld };
      }
    } catch (err) {
      return { ok: false, error: err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message, url: target.href };
    } finally {
      clearTimeout(timer);
    }
  });

  // D6: a cheap reachability probe per server, used by the Monitor's server switcher
  ipcMain.handle('strata:health', async (_event, { baseUrl, apiKey = '', timeoutMs = 2500 } = {}) => {
    if (!baseUrl) return { ok: false, error: 'no base url' };
    const target = buildTargetUrl(baseUrl, '/health');
    const policy = netPolicy.urlPolicy(target);
    if (!policy.ok) return { ok: false, error: policy.error, url: target ? target.href : String(baseUrl) };
    const useKey = strataKeyFor(target, apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const startedAt = Date.now();
    try {
      const response = await fetch(target, { headers: { accept: 'application/json', ...(useKey.key ? { authorization: `Bearer ${useKey.key}` } : {}) }, cache: 'no-store', signal: controller.signal });
      const text = await response.text();
      return { ok: response.ok, status: response.status, url: target.href, ms: Date.now() - startedAt, body: text.slice(0, 200), keyWithheld: useKey.withheld };
    } catch (err) {
      return { ok: false, error: err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message, url: target.href, ms: Date.now() - startedAt };
    } finally {
      clearTimeout(timer);
    }
  });

  ipcMain.handle('app:open-path', async (_event, { target, reveal = false }) => {
    if (!target) return { ok: false, error: 'no path' };
    if (reveal) {
      shell.showItemInFolder(target);
      return { ok: true };
    }
    const error = await shell.openPath(target);
    return { ok: !error, error };
  });

  ipcMain.handle('app:open-external', async (_event, url) => {
    const value = String(url || '');
    if (!/^https?:\/\//i.test(value)) return { ok: false, error: 'not an http(s) url' };
    try {
      await shell.openExternal(value);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

/* ------------------------------------------------------------------ */
/* lifecycle                                                           */
/* ------------------------------------------------------------------ */

const SMOKE = !!process.env.STRATAPILOT_SMOKE;
if (SMOKE) {
  // Keep automated runs isolated: separate profile, no single-instance lock.
  app.setPath('userData', path.join(app.getPath('temp'), 'stratapilot_smoke_profile'));
}

// Must run before anything logs, and after the userData override above.
appLog.init(path.join(app.getPath('userData'), 'logs', 'stratapilot.log'));
appLog.teeConsole();

/*
 * D10: Chromium's locale has to be set before ready - it decides navigator.language and the default
 * date / number formatting inside the window. Electron 40 has no app.setLocale, so this switch is the
 * only lever; the menu we build ourselves is rebuilt by applyLanguage() with the same language, and the
 * handful of Electron role items carry explicit translated labels (see buildMenu).
 */
try {
  let earlyPref = 'auto';
  try {
    earlyPref = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')).language || 'auto';
  } catch {
    earlyPref = 'auto';
  }
  const earlyLang = i18n.resolveLanguage(earlyPref, systemLocale());
  if (earlyLang !== 'en') app.commandLine.appendSwitch('lang', earlyLang);
} catch (err) {
  console.error(`[i18n] early --lang failed: ${err.message}`);
}

process.on('uncaughtException', (error, origin) => {
  console.error(`[fatal] uncaughtException (${origin}): ${(error && error.stack) || error}`);
  app.quit();
});
process.on('unhandledRejection', (reason) => {
  console.error(`[error] unhandledRejection: ${(reason && reason.stack) || reason}`);
});
app.on('child-process-gone', (_event, details) => {
  console.error(`[crash] ${details.type} process gone reason=${details.reason} code=${details.exitCode}`);
});

const gotLock = SMOKE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    const inv = resolvePiInvocation();
    appLog.banner({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      piVersion: inv.piVersion,
      platform: `${process.platform}/${process.arch}`,
      logFile: appLog.logPath(),
      smoke: SMOKE,
    });
    migrateSettings();
    usageLedger.setLedgerFile(USAGE_LEDGER_FILE());
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
    applyLanguage();          // resolves the language, loads the catalog and builds the menu in that language
    registerIpc();
    createWindow();
    cronStart();
    // D9: build / update the usage rollup once the window is up, so the footer chip and the chart
    // have numbers without making startup wait for a scan of every session on disk
    setTimeout(() => scheduleUsageRefresh(0), 2500);
    // A laptop that slept through 09:30 must not fire it at 11:00; it re-arms for tomorrow and the
    // user is told the run was missed (cronRecompute reports it).
    for (const event of ['resume', 'unlock-screen']) {
      try {
        powerMonitor.on(event, () => cronRecompute(event));
      } catch (err) {
        console.error(`[cron] powerMonitor.on(${event}) failed: ${err.message}`);
      }
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    cronStop();
    closeAllPiProcesses();
    app.quit();
  });

  app.on('before-quit', () => {
    cronStop();
    clearTimeout(usageRefreshTimer);
    // #8: this first flush is the "the app is going away right now" guarantee; the one armed by
    // closeAllPiProcesses() is the correct one, after the children have stopped writing. The ledger
    // re-scans changed files on the next start either way, so no token is written off - but the
    // rollup this app writes should be the complete one.
    usageLedger.flush();
    closeAllPiProcesses();
  });
}

/**
 * #8: both quit paths used to pass `graceMs: 300` - shorter than a model round trip and shorter than
 * a session-file flush on a slow disk, so quitting mid-run could leave the last entry of a session
 * half-written in a file the user expects to reopen intact. pi's documented orderly shutdown is
 * closing stdin (docs/rpc.md: there is no shutdown command), so the grace period IS the shutdown - it
 * is 5 s now, and it is logged per tab.
 */
function closeAllPiProcesses() {
  const result = disposeAll(processes, {
    graceMs: QUIT_GRACE_MS,
    onLog: (text) => console.log(text),
    onAllGone: () => usageLedger.flush(),
  });
  processes.clear();
  // a wedged child must never hold the app open: dispose() kills at graceMs, and this covers the case
  // where the exit event never arrives at all
  const failsafe = setTimeout(() => result.finished(), QUIT_GRACE_MS + 1500);
  failsafe.unref?.();
  return result;
}

