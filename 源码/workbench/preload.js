'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  status: () => ipcRenderer.invoke('vault:status'),
  setup: (password, data) => ipcRenderer.invoke('vault:setup', password, data),
  unlock: password => ipcRenderer.invoke('vault:unlock', password),
  save: data => ipcRenderer.sendSync('vault:save', data),
  backup: data => ipcRenderer.sendSync('vault:backup', data),
  changePassword: (current, next) => ipcRenderer.invoke('vault:password', current, next),
  restore: (raw, password) => ipcRenderer.invoke('vault:restore', raw, password),
  readBackup: (raw, password) => ipcRenderer.invoke('vault:read-backup', raw, password),
  lock: () => ipcRenderer.sendSync('vault:lock'),
  activity: () => ipcRenderer.send('vault:activity'),
  onLockRequested: callback => ipcRenderer.on('vault:lock-request', () => callback()),
  onCloseRequested: callback => ipcRenderer.on('app:close-request', () => callback()),
  closeReady: () => ipcRenderer.send('app:close-ready'),
  windowState: () => ipcRenderer.invoke('window:state'),
  windowMode: mode => ipcRenderer.invoke('window:mode', mode),
  windowControl: action => ipcRenderer.invoke('window:control', action),
  onWindowChanged: callback => ipcRenderer.on('window:changed', (event, state) => callback(state)),
  setTimeout: minutes => ipcRenderer.send('vault:timeout', minutes)
}));
