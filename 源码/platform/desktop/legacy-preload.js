'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('需要回调。');
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld(
  'desktop',
  Object.freeze({
    status: () => ipcRenderer.invoke('legacy:status'),
    setup: (_password, data) => ipcRenderer.invoke('legacy:setup', data),
    unlock: () => ipcRenderer.invoke('legacy:unlock'),
    save: (data) => ipcRenderer.sendSync('legacy:save', data),
    backup: (data) => ipcRenderer.sendSync('legacy:backup', data),
    changePassword: (current, next) => ipcRenderer.invoke('legacy:password', current, next),
    restore: (raw, password) => ipcRenderer.invoke('legacy:restore', raw, password),
    readBackup: (raw, password) => ipcRenderer.invoke('legacy:read-backup', raw, password),
    lock: () => ipcRenderer.sendSync('legacy:lock'),
    activity: () => ipcRenderer.send('legacy:activity'),
    onLockRequested: (callback) => subscribe('legacy:lock-request', () => callback()),
    onCloseRequested: (callback) => subscribe('legacy:close-request', () => callback()),
    closeReady: () => ipcRenderer.send('legacy:close-ready'),
    windowState: () => ipcRenderer.invoke('legacy:window-state'),
    windowMode: (mode) => ipcRenderer.invoke('legacy:window-mode', mode),
    windowControl: (action) => ipcRenderer.invoke('legacy:window-control', action),
    onWindowChanged: (callback) => subscribe('legacy:window-changed', callback),
    setTimeout: (minutes) => ipcRenderer.send('legacy:timeout', minutes),
    bootstrap: (defaults) => ipcRenderer.invoke('legacy:bootstrap', defaults),
    onNavigate: (callback) => subscribe('legacy:navigate', callback),
    onFlush: (callback) => subscribe('legacy:flush', callback),
    flushReady: (requestId, ok) => ipcRenderer.send('legacy:flush-ready', requestId, ok),
    ready: () => ipcRenderer.send('legacy:ready'),
    appearanceChanged: (value) => ipcRenderer.send('legacy:appearance', value),
  }),
);
