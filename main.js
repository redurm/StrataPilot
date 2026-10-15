'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell, Menu, clipboard } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PiRpcProcess } = require('./lib/pi-process');
const { resolvePiInvocation, TESTED_PI_VERSION } = require('./lib/pi-launch');
const sessions = require('./lib/sessions');
const appLog = require('./lib/log');
const diagnostics = require('./lib/diagnostics');

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

function createWindow() {
  const settings = loadSettings();
  const bounds = settings.windowBounds || { width: 1360, height: 900 };
  win = new BrowserWindow({
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
  // vanishing). None of these were recorded before, so it left no evidence.
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      `[crash] renderer gone reason=${details.reason} exitCode=${details.exitCode} killed=${details.killed}`,
    );
  });
  win.webContents.on('unresponsive', () => console.error('[crash] renderer unresponsive (>30s of no reply)'));
  win.webContents.on('responsive', () => console.error('[crash] renderer responsive again'));
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[crash] preload-error ${preloadPath}: ${(error && error.stack) || error}`);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    if (errorCode === -3) return; // ABORTED: normal during reload/navigation
    console.error(`[nav] did-fail-load code=${errorCode} ${errorDescription} url=${validatedUrl}`);
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
      piVersion: inv.piVersion,
      cliPath: inv.cliPath,
      nodePath: inv.nodePath,
      runAsNode: inv.runAsNode,
      sessionsRoot: sessions.sessionsRoot(),
      logPath: appLog.logPath(),
      settingsPath: SETTINGS_FILE(),
      testedPiVersion: TESTED_PI_VERSION,
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
    };
  });

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

  ipcMain.handle('fs:choose-folder', async () => {
    if (!win) return { ok: false };
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a working folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true };
    return { ok: true, path: result.filePaths[0] };
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
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    for (const proc of processes.values()) proc.dispose({ graceMs: 300 });
    processes.clear();
    app.quit();
  });

  app.on('before-quit', () => {
    for (const proc of processes.values()) proc.dispose({ graceMs: 300 });
    processes.clear();
  });
}
