'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const names = [
  'analysisStudio',
  'managedList',
  'managedCreate',
  'managedUpdate',
  'managedDelete',
  'managedRecover',
  'managedLayout',
  'managedReport',
  'managedFields',
  'managedOpen',
  'managedBackup',
  'managedRestore',

  'importModuleStateBackup',
  'readModuleState',
  'saveModuleState',
  'resetModuleState',
  'moduleStateHistory',
  'restoreModuleState',
  'moduleStateProfiles',
  'saveModuleStateProfile',
  'applyModuleStateProfile',
  'backupModuleState',
  'checkModuleState',
  'status',
  'chooseWorkspace',
  'unlock',
  'openDemo',
  'lock',
  'catalog',
  'overview',
  'homeReport',
  'homeOverview',
  'qualityReport',
  'pickLabelWorkbook',
  'exportLabels',
  'readLabelMemory',
  'saveLabelMemory',
  'biQuality',
  'listData',
  'pickWorkbook',
  'previewImport',
  'commitImport',
  'cancelImport',
  'backup',
  'restoreWorkspace',
  'showLegacy',
  'hideLegacy',
  'legacyAction',
  'appearance',
  'originalRecordInfo',
  'importOriginalRecords',
  'showBI',
  'hideBI',
  'biInfo',
  'backupBI',
  'importBIData',
];
const bridge = {};
for (const name of names)
  bridge[name] = (input) =>
    input === undefined
      ? ipcRenderer.invoke(`analysis:${name}`)
      : ipcRenderer.invoke(`analysis:${name}`, input);
bridge.onLocked = (callback) => {
  if (typeof callback !== 'function') throw new TypeError('需要回调。');
  const listener = () => callback();
  ipcRenderer.on('analysis:locked', listener);
  return () => ipcRenderer.removeListener('analysis:locked', listener);
};
bridge.onAppearance = (callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on('analysis:appearance', listener);
  return () => ipcRenderer.removeListener('analysis:appearance', listener);
};
bridge.onBIChanged = (callback) => {
  if (typeof callback !== 'function') throw new TypeError('需要回调。');
  const listener = () => callback();
  ipcRenderer.on('analysis:bi-changed', listener);
  return () => ipcRenderer.removeListener('analysis:bi-changed', listener);
};
bridge.onNavigateRequest = (callback) => {
  if (typeof callback !== 'function') throw new TypeError('需要回调。');
  const listener = (_event, input) => callback(input);
  ipcRenderer.on('analysis:navigate-request', listener);
  return () => ipcRenderer.removeListener('analysis:navigate-request', listener);
};
bridge.onFunctionSearch = (callback) => {
  if (typeof callback !== 'function') throw new TypeError('需要回调。');
  const listener = () => callback();
  ipcRenderer.on('analysis:function-search', listener);
  return () => ipcRenderer.removeListener('analysis:function-search', listener);
};
contextBridge.exposeInMainWorld('workbench', Object.freeze(bridge));
let lastActivity = 0;
for (const name of ['pointerdown', 'keydown', 'wheel'])
  window.addEventListener(
    name,
    () => {
      const now = Date.now();
      if (now - lastActivity > 1000) {
        lastActivity = now;
        ipcRenderer.send('analysis:activity');
      }
    },
    { capture: true, passive: true },
  );
