'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell, Menu, clipboard, powerMonitor } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PiRpcProcess } = require('./lib/pi-process');
const { resolvePiInvocation, TESTED_PI_VERSION, piVersionStatus } = require('./lib/pi-launch');
const sessions = require('./lib/sessions');
const appLog = require('./lib/log');
const diagnostics = require('./lib/diagnostics');
const cron = require('./lib/cron');

const APP_ID = 'com.pionstrata.app';
const SETTINGS_NAME = 'pi_on_strata_settings.json';
const SETTINGS_FILE = () => path.join(app.getPath('userData'), SETTINGS_NAME);

/**
 * The app was renamed from pi-gui to "Pi on Strata". Electron derives userData from the
 * app name, so the settings folder moved from %APPDATA%\pi-gui to %APPDATA%\Pi on Strata.
 * Carry the old file over once so open tabs, window bounds and monitor preferences survive.
 */
function migrateSettings() {
  const target = SETTINGS_FILE();
  try {
    if (fs.existsSync(target)) return;
    const candidates = [
      path.join(app.getPath('userData'), 'pi_gui_settings.json'),
      path.join(path.dirname(app.getPath('userData')), 'pi-gui', 'pi_gui_settings.json'),
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
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('settings save failed:', err.message);
  }
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
    title: 'Pi on Strata',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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

  if (process.env.PI_ON_STRATA_SMOKE) {
    console.log(`[smoke] window ${JSON.stringify(win.getBounds())}`);
  }

  win.webContents.on('console-message', (event) => {
    const level = Number(event.level) || 0;
    const message = event.message;
    const source = event.sourceId;
    const position = event.lineNumber ? `:${event.lineNumber}:${event.columnNumber}` : '';
    if (process.env.PI_ON_STRATA_SMOKE && level < 2) {
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
        title: 'Pi on Strata',
        message: cause,
        detail:
          `${detail || ''}\n\nSessions are not closed: every pi session runs as its own process owned by the background process, `
          + 'and reloading the interface re-attaches to the ones that are still alive. A generation that was running right now is interrupted.\n\n'
          + 'The log file (Help \u25b8 Open Log Folder) holds what happened.',
        buttons: ['Reload interface', 'Keep the window as it is'],
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
    recoverInterface('The interface stopped responding and was closed by Windows', `reason=${details.reason} exitCode=${details.exitCode}`);
  });
  win.webContents.on('unresponsive', () => {
    console.error('[crash] renderer unresponsive (>30s of no reply)');
    unresponsiveReported = true;
    recoverInterface('The interface has stopped responding', 'It has not answered for over 30 seconds \u2014 usually a stuck render, not a lost session.');
  });
  win.webContents.on('responsive', () => {
    console.error('[crash] renderer responsive again');
    if (unresponsiveReported) {
      unresponsiveReported = false;
      send('recovery', { kind: 'recovered', cause: 'The interface answered again \u2014 nothing was reloaded.' });
    }
  });
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[crash] preload-error ${preloadPath}: ${(error && error.stack) || error}`);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    if (errorCode === -3) return; // ABORTED: normal during reload/navigation
    console.error(`[nav] did-fail-load code=${errorCode} ${errorDescription} url=${validatedUrl}`);
    recoverInterface('The interface failed to load', `code=${errorCode} ${errorDescription}`);
  });

  if (process.env.PI_ON_STRATA_SMOKE) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        console.error('[smoke] quitting after startup window');
        app.quit();
      }, Number(process.env.PI_ON_STRATA_SMOKE_MS || 8000));
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
      label: 'Session',
      submenu: [
        { label: 'New Session', accelerator: 'CmdOrCtrl+T', click: () => send('menu', 'new-session') },
        {
          label: 'New Session In Current Tab',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => send('menu', 'reset-tab'),
        },
        { label: 'Open Session…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open-session') },
        { label: 'Rename Session', accelerator: 'F2', click: () => send('menu', 'rename-tab') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('menu', 'settings') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => send('menu', 'close-tab') },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Tab', click: () => send('menu', 'next-tab') },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+Tab', click: () => send('menu', 'prev-tab') },
        { type: 'separator' },
        { role: isMac ? 'close' : 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => send('menu', 'toggle-sidebar') },
        { label: 'Toggle Strata Monitor', accelerator: 'CmdOrCtrl+M', click: () => send('menu', 'toggle-monitor') },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win && win.webContents.reload() },
        { label: 'DevTools', accelerator: 'CmdOrCtrl+Shift+I', click: () => win && win.webContents.toggleDevTools() },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Log Folder',
          click: () => {
            const dir = appLog.logDir();
            if (dir) shell.openPath(dir);
            else shell.openPath(app.getPath('userData'));
          },
        },
        {
          label: 'First-run check',
          click: () => send('first-run', {}),
        },
        {
          label: 'Copy Diagnostics',
          click: async () => {
            // same report the composer button produces; the menu path also puts it on the
            // clipboard straight from main, so it works even when the renderer is wedged
            const report = await buildDiagnostics({});
            clipboard.writeText(report.text);
            send('diagnostics', report);
          },
        },
        {
          label: 'pi RPC docs',
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

  proc.on('record', (record) => send('pi:record', { tabId, record }));
  proc.on('stderr', (text) => {
    console.error(`[pi stderr tab=${tabId}] ${text.slice(0, 1000)}`);
    send('pi:stderr', { tabId, text: text.slice(0, 4000) });
  });
  proc.on('log', (text) => {
    console.log(`[pi log tab=${tabId}] ${text}`);
    send('pi:log', { tabId, text });
  });
  proc.on('exit', (info) => {
    // A tab's pi dying is often what the user perceives as "the UI crashed".
    console.error(
      `[pi exit tab=${tabId}] code=${info && info.code} signal=${info && info.signal} stderrTail=${JSON.stringify(
        String((info && info.stderr) || '').slice(-500),
      )}`,
    );
    processes.delete(tabId);
    send('pi:exit', { tabId, ...info });
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
  let changed = false;
  for (const job of jobs) {
    if (!job.enabled || !job.nextRun) continue;
    const due = Date.parse(job.nextRun);
    if (!Number.isFinite(due) || due > now.getTime()) continue;
    if (now.getTime() - due > CRON_GRACE_MS) continue; // handled by cronRecompute as "missed"
    console.log(`[cron] firing "${job.name || job.schedule}" (${job.schedule}) target=${job.target || 'new-tab'}`);
    send('cron:fire', { job, firedAt: now.toISOString(), manual: false });
    job.lastRun = now.toISOString();
    let next = null;
    try {
      next = cron.nextRun(job.schedule, now);
    } catch (err) {
      console.error(`[cron] job ${job.id} has an invalid schedule (${job.schedule}): ${err.message}`);
    }
    job.nextRun = next ? next.toISOString() : null;
    changed = true;
  }
  if (changed) saveJobs(jobs);
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

/* ------------------------------------------------------------------ */
/* diagnostics report (A6: "Copy diagnostics")                        */
/* ------------------------------------------------------------------ */

/** GET a URL and return { ok, text } — the raw body, so /health can be quoted verbatim. */
async function fetchText(url, { apiKey = '', timeoutMs = 4000 } = {}) {
  const controller = new AbortController();
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

  const strata = { baseUrl: baseUrl || '(none: no tab with a model, and no strataUrl setting)' };
  if (baseUrl) {
    const key = String(payload.apiKey || process.env.PI_ON_STRATA_KEY || process.env.STRATA_API_KEY || '');
    const health = await fetchText(`${baseUrl}/health`, { apiKey: key });
    strata.healthText = health.ok ? oneLineJson(health.text) : health.error;
    const models = await fetchText(`${baseUrl}/v1/models`, { apiKey: key });
    strata.modelsText = models.ok ? oneLineJson(models.text) : models.error;
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
  };

  const text = diagnostics.format(data);
  let savedTo = '';
  try {
    const dir = path.join(app.getPath('userData'), 'diagnostics');
    fs.mkdirSync(dir, { recursive: true });
    savedTo = path.join(dir, `pi_on_strata_diagnostics_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    fs.writeFileSync(savedTo, text, 'utf8');
  } catch (err) {
    console.error(`[diagnostics] could not save report: ${err.message}`);
  }
  console.log(`[diagnostics] report built lines=${text.split('\n').length} saved=${savedTo}`);
  return { ok: true, text, path: savedTo };
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
      // PI_ON_STRATA_SMOKE_PI_VERSION fakes the reported pi version so the version guard (C6)
      // can be exercised without installing a different pi
      piVersion: process.env.PI_ON_STRATA_SMOKE_PI_VERSION || inv.piVersion,
      testedPiVersion: TESTED_PI_VERSION,
      piVersionLevel: piVersionStatus(process.env.PI_ON_STRATA_SMOKE_PI_VERSION || inv.piVersion, TESTED_PI_VERSION).level,
      cliPath: inv.cliPath,
      nodePath: inv.nodePath,
      runAsNode: inv.runAsNode,
      sessionsRoot: sessions.sessionsRoot(),
      logPath: appLog.logPath(),
      settingsPath: SETTINGS_FILE(),
      defaultCwd: process.cwd(),
      home: os.homedir(),
      smoke: !!process.env.PI_ON_STRATA_SMOKE,
      smokePrompt: process.env.PI_ON_STRATA_SMOKE_PROMPT || '',
      smokeSession: process.env.PI_ON_STRATA_SMOKE_SESSION || '',
      smokeSteer: !!process.env.PI_ON_STRATA_SMOKE_STEER,
      smokeQueue: !!process.env.PI_ON_STRATA_SMOKE_QUEUE,
      smokeMonitor: !!process.env.PI_ON_STRATA_SMOKE_MONITOR,
      smokeCompact: !!process.env.PI_ON_STRATA_SMOKE_COMPACT,
      smokeOrder: !!process.env.PI_ON_STRATA_SMOKE_ORDER,
      smokeAutoCompact: !!process.env.PI_ON_STRATA_SMOKE_AUTO_COMPACT,
      smokeBash: !!process.env.PI_ON_STRATA_SMOKE_BASH,
      smokeBars: !!process.env.PI_ON_STRATA_SMOKE_BARS,
      smokePaste: !!process.env.PI_ON_STRATA_SMOKE_PASTE,
      smokeCopy: !!process.env.PI_ON_STRATA_SMOKE_COPY,
      smokeExport: !!process.env.PI_ON_STRATA_SMOKE_EXPORT,
      smokeExportOut: process.env.PI_ON_STRATA_SMOKE_EXPORT_OUT || path.join(os.tmpdir(), 'pi_on_strata_smoke_export.html'),
      smokeDiag: !!process.env.PI_ON_STRATA_SMOKE_DIAG,
      smokeSettings: !!process.env.PI_ON_STRATA_SMOKE_SETTINGS,
      smokeRetry: !!process.env.PI_ON_STRATA_SMOKE_RETRY,
      smokeOutbox: !!process.env.PI_ON_STRATA_SMOKE_OUTBOX,
      smokeCron: !!process.env.PI_ON_STRATA_SMOKE_CRON,
      smokeTabTag: !!process.env.PI_ON_STRATA_SMOKE_TABTAG,
      smokeTheme: !!process.env.PI_ON_STRATA_SMOKE_THEME,
      smokeA11y: !!process.env.PI_ON_STRATA_SMOKE_A11Y,
      smokeStorage: !!process.env.PI_ON_STRATA_SMOKE_STORAGE,
      smokeServers: !!process.env.PI_ON_STRATA_SMOKE_SERVERS,
      smokePath: !!process.env.PI_ON_STRATA_SMOKE_PATH,
      smokeTree: !!process.env.PI_ON_STRATA_SMOKE_TREE,
      smokeFork: !!process.env.PI_ON_STRATA_SMOKE_FORK,
      smokeSetup: !!process.env.PI_ON_STRATA_SMOKE_SETUP,
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
    console.log(`[cron] run-now "${job.name}" (manual)`);
    send('cron:fire', { job, firedAt: new Date().toISOString(), manual: true });
    return { ok: true };
  });

  // Smoke-only: lets a scenario take a screenshot (theme checks, layout checks). Never registered
// outside smoke mode.
if (process.env.PI_ON_STRATA_SMOKE) {
  ipcMain.handle('app:smoke-shot', async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender) || win();
    const name = String((payload && payload.name) || 'shot').replace(/[^a-z0-9_-]/gi, '');
    try {
      const image = await win.webContents.capturePage();
      const file = path.join(os.tmpdir(), `pi-on-strata-smoke-${name}.png`);
      fs.writeFileSync(file, image.toPNG());
      console.log(`[smoke-shot] wrote ${file} bounds=${JSON.stringify(win.getContentBounds())}`);
      return { ok: true, file };
    } catch (err) {
      console.error(`[smoke-shot] failed: ${err.stack || err}`);
      return { ok: false, error: err.message };
    }
  });
}

ipcMain.handle('app:diagnostics', async (_event, payload) => buildDiagnostics(payload && typeof payload === 'object' ? payload : {}));

  ipcMain.handle('app:settings-get', () => loadSettings());
  ipcMain.handle('app:settings-set', (_event, patch) => {
    const merged = { ...loadSettings(), ...(patch && typeof patch === 'object' ? patch : {}) };
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
      return { ok: true, ...result };
    } catch (err) {
      console.error(`[sessions:cleanup-run] failed: ${err.stack || err}`);
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
      title: 'Choose a working folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };
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
      title,
      properties: ['openFile'],
      ...(Array.isArray(filters) && filters.length ? { filters } : {}),
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  // Plain dialog wrapper only: the renderer never writes through this, pi's export_html
  // does the writing. Cancelling is a normal outcome (cancelled:true), not an error.
  ipcMain.handle('fs:save-file', async (_event, { defaultPath = '', title = 'Save file' } = {}) => {
    if (!win) return { ok: false };
    const result = await dialog.showSaveDialog(win, {
      title,
      defaultPath,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle('fs:stat-paths', (_event, { paths: items = [] }) => {
    return items.map((item) => {
      try {
        const stat = fs.statSync(item);
        return {
          path: item,
          name: path.basename(item),
          dir: path.dirname(item),
          size: stat.size,
          isDirectory: stat.isDirectory(),
          ext: path.extname(item).toLowerCase(),
        };
      } catch (err) {
        return { path: item, name: path.basename(item), error: err.message };
      }
    });
  });

  ipcMain.handle('fs:read-text', (_event, { filePath, maxBytes = 200000 }) => {
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) return { ok: false, error: 'is a directory' };
      if (stat.size > maxBytes) return { ok: false, error: `file larger than ${maxBytes} bytes`, tooLarge: true };
      return { ok: true, text: fs.readFileSync(filePath, 'utf8'), size: stat.size };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('strata:metrics', async (_event, { baseUrl, all = false, apiKey = '', timeoutMs = 4000 } = {}) => {
    if (!baseUrl) return { ok: false, error: 'no base url' };
    let target;
    try {
      const trimmed = String(baseUrl).replace(/\/+$/, '').replace(/\/v1$/i, '');
      target = new URL(`${trimmed}/metrics${all ? '?requests=all' : ''}`);
    } catch {
      return { ok: false, error: `invalid base url: ${baseUrl}` };
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return { ok: false, error: 'unsupported protocol' };
    const key = apiKey || process.env.PI_ON_STRATA_KEY || process.env.STRATA_API_KEY || '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetch(target, {
        headers: { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        cache: 'no-store',
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, status: response.status, url: target.href };
      try {
        return { ok: true, url: target.href, data: JSON.parse(text) };
      } catch {
        return { ok: false, error: 'response was not JSON', url: target.href };
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
    let target;
    try {
      target = new URL(`${String(baseUrl).replace(/\/+$/, '').replace(/\/v1$/i, '')}/health`);
    } catch {
      return { ok: false, error: `invalid base url: ${baseUrl}` };
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return { ok: false, error: 'unsupported protocol' };
    const key = apiKey || process.env.PI_ON_STRATA_KEY || process.env.STRATA_API_KEY || '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const startedAt = Date.now();
    try {
      const response = await fetch(target, { headers: { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, cache: 'no-store', signal: controller.signal });
      const text = await response.text();
      return { ok: response.ok, status: response.status, url: target.href, ms: Date.now() - startedAt, body: text.slice(0, 200) };
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

const SMOKE = !!process.env.PI_ON_STRATA_SMOKE;
if (SMOKE) {
  // Keep automated runs isolated: separate profile, no single-instance lock.
  app.setPath('userData', path.join(app.getPath('temp'), 'pi_on_strata_smoke_profile'));
}

// Must run before anything logs, and after the userData override above.
appLog.init(path.join(app.getPath('userData'), 'logs', 'pi_on_strata.log'));
appLog.teeConsole();

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
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
    buildMenu();
    registerIpc();
    createWindow();
    cronStart();
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
    for (const proc of processes.values()) proc.dispose({ graceMs: 300 });
    processes.clear();
    app.quit();
  });

  app.on('before-quit', () => {
    cronStop();
    for (const proc of processes.values()) proc.dispose({ graceMs: 300 });
    processes.clear();
  });
}
