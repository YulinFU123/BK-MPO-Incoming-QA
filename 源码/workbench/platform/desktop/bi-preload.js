'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const bridge = {
  request: (input) => ipcRenderer.invoke('bi:request', input),
  flushReady: (id, ok) => ipcRenderer.send('bi:flush-ready', id, ok),
  activity: () => ipcRenderer.send('bi:activity'),
  navigate: (section) => ipcRenderer.send('bi:navigate-request', section),
};
for (const [name, channel] of [
  ['onNavigate', 'bi:navigate'],
  ['onFlush', 'bi:flush'],
])
  bridge[name] = (callback) => {
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
contextBridge.exposeInMainWorld('bi', Object.freeze(bridge));
let last = 0;
for (const name of ['pointerdown', 'keydown', 'wheel'])
  window.addEventListener(
    name,
    () => {
      if (Date.now() - last > 1000) {
        last = Date.now();
        bridge.activity();
      }
    },
    { capture: true, passive: true },
  );
