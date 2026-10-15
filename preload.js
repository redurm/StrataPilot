'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENT_CHANNELS = new Set(['pi:record', 'pi:stderr', 'pi:log', 'pi:exit', 'menu', 'diagnostics', 'recovery']);

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
  sessionsRename: (sessionPath, name) => ipcRenderer.invoke('sessions:rename', { sessionPath, name }),

  /* filesystem -------------------------------------------------------- */
  chooseFolder: () => ipcRenderer.invoke('fs:choose-folder'),
  chooseFile: (payload = {}) => ipcRenderer.invoke('fs:choose-file', payload),
  saveFile: (payload = {}) => ipcRenderer.invoke('fs:save-file', payload),
  statPaths: (paths) => ipcRenderer.invoke('fs:stat-paths', { paths }),
  readText: (filePath, maxBytes) => ipcRenderer.invoke('fs:read-text', { filePath, maxBytes }),
  openPath: (target, reveal) => ipcRenderer.invoke('app:open-path', { target, reveal }),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  /* strata server monitor (proxied from main to dodge CSP/CORS) --------- */
  strataMetrics: (payload) => ipcRenderer.invoke('strata:metrics', payload),

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
