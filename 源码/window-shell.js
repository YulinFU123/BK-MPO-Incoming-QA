'use strict';

// Window geometry belongs to the main process, never to renderer-supplied coordinates.
function fitBounds(preferred, area) {
  const width = Math.min(preferred.width, area.width);
  const height = Math.min(preferred.height, area.height);
  return {
    x: Math.round(Math.max(area.x, Math.min(preferred.x ?? area.x + (area.width - width) / 2, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(preferred.y ?? area.y + (area.height - height) / 2, area.y + area.height - height))),
    width, height
  };
}

function authBounds(area) {
  return fitBounds({width: Math.min(1100, area.width - 24), height: Math.min(680, area.height - 24)}, area);
}

function createWindowShell(win, screen) {
  let mode = 'auth';
  let workspace;
  const state = () => ({mode, maximized: win.isMaximized(), minimized: win.isMinimized(), bounds: win.getBounds()});
  const notify = () => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('window:changed', state());
  };
  function setMode(next) {
    if (!['auth', 'workspace'].includes(next)) throw Error('窗口模式无效。');
    if (mode === next) return state();
    const current = win.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    if (mode === 'workspace') workspace = {bounds: win.getNormalBounds(), maximized: win.isMaximized()};
    if (win.isMaximized()) win.unmaximize();
    mode = next;
    if (mode === 'auth') {
      win.setMinimumSize(1, 1);
      win.setMaximizable(false);
      win.setResizable(false);
      win.setBounds(authBounds(area));
    } else {
      win.setResizable(true);
      win.setMaximizable(true);
      win.setMinimumSize(Math.min(1024, area.width), Math.min(720, area.height));
      win.setBounds(fitBounds(workspace?.bounds ?? {width: 1440, height: 960}, area));
      if (workspace?.maximized) win.maximize();
    }
    notify();
    return state();
  }
  function control(action) {
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize' && mode === 'workspace') {
      if (win.isMaximized()) win.unmaximize(); else win.maximize();
    } else if (action === 'close') win.close(); // Existing close/save handshake remains authoritative.
    else throw Error('窗口操作无效。');
    return win.isDestroyed() ? null : state();
  }
  for (const event of ['maximize', 'unmaximize', 'minimize', 'restore', 'resize']) win.on(event, notify);
  return {setMode, control, state};
}

module.exports = {fitBounds, authBounds, createWindowShell};
