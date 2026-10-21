'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENT_CHANNELS = new Set(['pi:record', 'pi:stderr', 'pi:log', 'pi:exit', 'menu', 'diagnostics', 'recovery', 'cron:fire', 'cron:notice', 'first-run']);

const api = {
  /* environment ------------------------------------------------------- */
  info: () => ipcRenderer.invoke('app:info'),
  settingsGet: () => ipcRenderer.invoke('app:settings-get'),
  settingsSet: (patch) => ipcRenderer.invoke('app:settings-set', patch),

  /* pi RPC ------------------------------------------------------------ */
  spawn: (payload) => ipcRenderer.invoke('pi:spawn', payload),
  cmd: (tabId, type, fields = {}, timeoutMs) => ipcRenderer.invoke('pi:cmd', { tabId, type, fields, timeoutMs }),
  uiResponse: (tabId, response) => ipcRenderer.invoke('pi:ui-response', { tabId, response }),
  dispose: (tabId) => ipcRenderer.invoke('pi:dispose', { tabId }),
  alive: (tabIds) => ipcRenderer.invoke('pi:alive', { tabIds }),

  /* sessions ---------------------------------------------------------- */
  sessionsList: (payload) => ipcRenderer.invoke('sessions:list', payload),
  sessionsRead: (sessionPath) => ipcRenderer.invoke('sessions:read', { sessionPath }),
  sessionsDelete: (sessionPath) => ipcRenderer.invoke('sessions:delete', { sessionPath }),
  sessionsStats: () => ipcRenderer.invoke('sessions:stats'),
  sessionsCleanupPlan: (payload = {}) => ipcRenderer.invoke('sessions:cleanup-plan', payload),
  sessionsCleanupRun: (payload = {}) => ipcRenderer.invoke('sessions:cleanup-run', payload),
  sessionsRename: (sessionPath, name) => ipcRenderer.invoke('sessions:rename', { sessionPath, name }),

  /* token usage ledger (D9) ------------------------------------------ */
  usageSeries: (payload = {}) => ipcRenderer.invoke('usage:series', payload),
  usageSummary: () => ipcRenderer.invoke('usage:summary'),
  usageRecount: () => ipcRenderer.invoke('usage:recount'),

  /* language (D10) ----------------------------------------------------
   * main owns the catalog files (the renderer has no fs) and the native menu, so the renderer asks
   * for the active language + catalog and tells main when the user picks another one. */
  i18nGet: () => ipcRenderer.invoke('i18n:get'),
  i18nSet: (language) => ipcRenderer.invoke('i18n:set', { language }),

  /* filesystem -------------------------------------------------------- */
  chooseFolder: () => ipcRenderer.invoke('fs:choose-folder'),
  chooseFile: (payload = {}) => ipcRenderer.invoke('fs:choose-file', payload),
  fsComplete: (payload = {}) => ipcRenderer.invoke('fs:complete', payload),
  smokeShot: (name) => ipcRenderer.invoke('app:smoke-shot', { name }),
  smokeQuit: () => ipcRenderer.invoke('app:smoke-quit'),
  saveFile: (payload = {}) => ipcRenderer.invoke('fs:save-file', payload),
  statPaths: (paths) => ipcRenderer.invoke('fs:stat-paths', { paths }),
  // #6: `fs:read-text` had no preload binding removed-by-accident story - it simply had no caller at
  // all, while being able to read any file on disk. The binding is gone; the handler is still guarded.
  openPath: (target, reveal) => ipcRenderer.invoke('app:open-path', { target, reveal }),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  /* strata server monitor (proxied from main to dodge CSP/CORS) --------- */
  strataMetrics: (payload) => ipcRenderer.invoke('strata:metrics', payload),
  strataHealth: (payload) => ipcRenderer.invoke('strata:health', payload),
  setSessionPath: (payload) => ipcRenderer.invoke('pi:session-path', payload),

  /* scheduled jobs (B5) -------------------------------------------------
   * The scheduler runs in main (it survives a renderer reload) but only announces due jobs:
   * the renderer is the one place that owns the serial queue, so the prompt enters through it. */
  cronList: () => ipcRenderer.invoke('cron:list'),
  cronSave: (jobs) => ipcRenderer.invoke('cron:save', { jobs }),
  cronPreview: (schedule) => ipcRenderer.invoke('cron:preview', { schedule }),
  cronRunNow: (id) => ipcRenderer.invoke('cron:run-now', { id }),
  // #9: main waits for this before it writes lastRun - a fire the renderer never took is not a run
  cronAck: (key) => ipcRenderer.send('cron:ack', { key }),

  /* diagnostics -------------------------------------------------------- */
  /** Build the report asked for by docs/TROUBLESHOOTING.md (queue snapshot comes from us). */
  diagnostics: (payload = {}) => ipcRenderer.invoke('app:diagnostics', payload),
  /** Forward an uncaught renderer error to the main process log (fire and forget). */
  clientError: (entry) => ipcRenderer.send('app:client-error', entry),

  /** Absolute path of a dropped File (Electron >= 29 replaces File.path). */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (err) {
      if (file && typeof file.path === 'string') return file.path;
      return '';
    }
  },

  on(channel, handler) {
    if (!EVENT_CHANNELS.has(channel)) throw new Error(`unsupported channel: ${channel}`);
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('piGui', api);
