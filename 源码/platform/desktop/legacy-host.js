'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { PlatformError } = require('../domain/errors');
const { legacyRoot } = require('../adapters/legacy/full-state');
const commonActions = require('./legacy-common-actions');

const REGISTERED_CHANNELS = Object.freeze([
  'legacy:status',
  'legacy:setup',
  'legacy:unlock',
  'legacy:save',
  'legacy:backup',
  'legacy:password',
  'legacy:restore',
  'legacy:read-backup',
  'legacy:lock',
  'legacy:activity',
  'legacy:close-ready',
  'legacy:window-state',
  'legacy:window-mode',
  'legacy:window-control',
  'legacy:timeout',
  'legacy:bootstrap',
  'legacy:flush-ready',
  'legacy:ready',
  'legacy:lock-request',
  'legacy:close-request',
  'legacy:window-changed',
  'legacy:navigate',
  'legacy:flush',
  'legacy:appearance',
]);

function createLegacyHost({ window, controller, onLock, onAppearance = () => {}, qa = false }) {
  const { WebContentsView, ipcMain } = require('electron');
  const root = legacyRoot(),
    url = pathToFileURL(path.join(root, 'index.html')).href;
  let view = null,
    ready = false,
    visible = false,
    lastSection = null,
    requestedSection = 'entry',
    disposed = false,
    idleMinutes = 10,
    lastActivity = Date.now(),
    idlePending = false;
  const touch = () => {
    lastActivity = Date.now();
    idlePending = false;
  };
  const pendingFlush = new Map();
  const readyWaiters = new Set();
  let generation = 0;
  const trusted = (event) =>
    !disposed &&
    !!view &&
    event.sender === view.webContents &&
    event.senderFrame === view.webContents.mainFrame &&
    event.senderFrame.url.split('#')[0] === url &&
    controller.status().unlocked;
  const state = () => ({ maximized: window.isMaximized(), mode: 'workspace' });
  const syncResult = (fn) => {
    try {
      return { ok: true, value: fn() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof PlatformError ? error.message : '操作未保存，请检查数据和权限。',
      };
    }
  };
  const handlers = {
    'legacy:status': () => ({ exists: true }),
    'legacy:setup': (defaults) => controller.legacyBootstrap(defaults),
    'legacy:unlock': () => controller.legacyBootstrap(null),
    'legacy:bootstrap': (defaults) => controller.legacyBootstrap(defaults),
    'legacy:password': (current, next) => controller.legacyChangePassword(current, next),
    'legacy:restore': (raw, password) => controller.legacyRestore(raw, password),
    'legacy:read-backup': (raw, password) => controller.legacyReadBackup(raw, password),
    'legacy:window-state': state,
    'legacy:window-mode': () => state(),
    'legacy:window-control': (action) => {
      if (action === 'minimize') window.minimize();
      else if (action === 'maximize')
        window.isMaximized() ? window.unmaximize() : window.maximize();
      else if (action === 'close') window.close();
      else throw new PlatformError('INVALID_WINDOW_ACTION', '窗口操作无效。');
      return state();
    },
  };
  for (const [channel, handler] of Object.entries(handlers))
    ipcMain.handle(channel, async (event, ...args) => {
      if (!trusted(event)) return { ok: false, error: '工作区已锁定或来源无效。' };
      const captured = view;
      try {
        const value = await handler(...args);
        if (!trusted(event) || view !== captured)
          throw new PlatformError('SESSION_CHANGED', '工作区已切换。');
        lastActivity = Date.now();
        return { ok: true, value };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof PlatformError ? error.message : '操作失败，请检查密码、数据或权限。',
        };
      }
    });
  const listeners = {
    'legacy:appearance': (event, value) => {
      if (
        trusted(event) &&
        value &&
        ['professional', 'glass', 'graphite', 'contrast'].includes(value.theme) &&
        typeof value.preview === 'boolean'
      )
        onAppearance({
          theme: value.theme === 'professional' ? 'silver' : value.theme,
          preview: value.preview,
        });
    },
    'legacy:save': (event, data) => {
      event.returnValue = trusted(event)
        ? syncResult(() => controller.legacySave(data))
        : { ok: false, error: '工作区已锁定。' };
    },
    'legacy:backup': (event, data) => {
      event.returnValue = trusted(event)
        ? syncResult(() => controller.legacyBackup(data))
        : { ok: false, error: '工作区已锁定。' };
    },
    'legacy:lock': (event) => {
      const allowed = trusted(event);
      event.returnValue = allowed
        ? { ok: true, value: true }
        : { ok: false, error: '工作区已锁定。' };
      if (allowed) setImmediate(() => onLock());
    },
    'legacy:activity': (event) => {
      if (trusted(event)) touch();
    },
    'legacy:timeout': (event, value) => {
      if (trusted(event)) {
        idleMinutes = [0, 5, 10, 15, 30].includes(Number(value)) ? Number(value) : 10;
        lastActivity = Date.now();
      }
    },
    'legacy:close-ready': (event) => {
      if (trusted(event)) window.close();
    },
    'legacy:ready': (event) => {
      if (trusted(event)) {
        ready = true;
        view.webContents.send('legacy:navigate', requestedSection);
        lastSection = requestedSection;
        for (const finish of readyWaiters) finish(true);
      }
    },
    'legacy:flush-ready': (event, id, ok) => {
      if (trusted(event) && pendingFlush.has(id)) {
        pendingFlush.get(id)(ok === true);
        pendingFlush.delete(id);
      }
    },
  };
  for (const [channel, handler] of Object.entries(listeners)) ipcMain.on(channel, handler);
  const idle = setInterval(() => {
    if (
      controller.status().unlocked &&
      idleMinutes &&
      !idlePending &&
      Date.now() - lastActivity > idleMinutes * 60000
    ) {
      idlePending = true;
      if (view && ready) view.webContents.send('legacy:lock-request');
      else onLock();
    }
  }, 5000);
  idle.unref();

  function destroyView() {
    generation++;
    ready = false;
    visible = false;
    lastSection = null;
    if (view) {
      window.contentView.removeChildView(view);
      view.webContents.close();
      view = null;
    }
    for (const finish of pendingFlush.values()) finish(false);
    pendingFlush.clear();
    for (const finish of readyWaiters) finish(false);
  }
  async function show({ section, bounds, theme = 'silver' }) {
    const ticket = ++generation;
    if (!controller.status().unlocked)
      throw new PlatformError('WORKSPACE_LOCKED', '请先打开工作区。');
    if (
      !['entry', 'records', 'analysis', 'followup', 'settings', 'security', 'appearance'].includes(
        section,
      )
    )
      throw new PlatformError('INVALID_LEGACY_VIEW', '模块不存在。');
    if (!bounds || ['x', 'y', 'width', 'height'].some((key) => !Number.isFinite(bounds[key])))
      throw new PlatformError('INVALID_BOUNDS', '模块布局无效。');
    const [width, height] = window.getContentSize();
    const x = Math.max(0, Math.min(width - 1, Math.round(bounds.x))),
      y = Math.max(0, Math.min(height - 1, Math.round(bounds.y)));
    requestedSection = section;
    if (!view) {
      view = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, 'legacy-preload.js'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          devTools: qa,
          spellcheck: false,
        },
      });
      window.contentView.addChildView(view);
      view.setBounds({
        x,
        y,
        width: Math.max(1, Math.min(width - x, Math.round(bounds.width))),
        height: Math.max(1, Math.min(height - y, Math.round(bounds.height))),
      });
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      view.webContents.on('will-navigate', (event, target) => {
        if (target.split('#')[0] !== url) event.preventDefault();
      });
      const owned = view;
      let surfaceWork = Promise.resolve();
      owned.webContents.on('did-finish-load', () => {
        surfaceWork = (async () => {
          if (owned !== view || owned.webContents.isDestroyed()) return;
          await owned.webContents.insertCSS(
            fs.readFileSync(path.join(__dirname, 'legacy-surface.css'), 'utf8') +
              '\n' +
              fs.readFileSync(path.join(__dirname, 'shared-controls.css'), 'utf8') +
              '\n' +
              fs.readFileSync(path.join(__dirname, 'field-controls.css'), 'utf8') +
              '\n' +
              fs.readFileSync(path.join(__dirname, 'chart-surface.css'), 'utf8') +
              fs.readFileSync(path.join(__dirname, 'insight-summary.css'), 'utf8'),
          );
          if (owned !== view || owned.webContents.isDestroyed()) return;
          await owned.webContents.executeJavaScript(
            fs.readFileSync(path.join(__dirname, 'selection-controls.js'), 'utf8'),
          );
          await owned.webContents.executeJavaScript(
            fs.readFileSync(path.join(__dirname, 'legacy-common-actions.js'), 'utf8'),
          );
          await owned.webContents.executeJavaScript(
            fs.readFileSync(path.join(__dirname, 'field-controls.js'), 'utf8'),
          );
          await owned.webContents.executeJavaScript(
            fs.readFileSync(path.join(__dirname, 'chart-surface.js'), 'utf8'),
          );
          await owned.webContents.executeJavaScript(
            fs.readFileSync(path.join(__dirname, '../domain/insights.js'), 'utf8'),
          );
          await owned.webContents.executeJavaScript(
            fs.readFileSync(path.join(__dirname, 'insight-summary.js'), 'utf8'),
          );
          await owned.webContents.executeJavaScript(
            fs.readFileSync(path.join(__dirname, 'legacy-charts.js'), 'utf8'),
          );
          if (owned !== view || owned.webContents.isDestroyed()) return;
          await owned.webContents.executeJavaScript(
            fs.readFileSync(path.join(__dirname, 'legacy-surface.js'), 'utf8'),
          );
        })();
        // The owning load may be cancelled during lock. Its route receives the
        // error; never let an expected view disposal become an unhandled error.
        surfaceWork.catch(() => {});
      });
      await owned.webContents.loadFile(path.join(root, 'index.html'));
      await surfaceWork;
    }
    if (ticket !== generation) return { visible: false, cancelled: true };
    view.setBounds({
      x,
      y,
      width: Math.max(1, Math.min(width - x, Math.round(bounds.width))),
      height: Math.max(1, Math.min(height - y, Math.round(bounds.height))),
    });
    view.setVisible(true);
    visible = true;
    if (ready && lastSection !== section) {
      view.webContents.send('legacy:navigate', section);
      lastSection = section;
    }
    if (['silver', 'glass', 'graphite', 'contrast'].includes(theme))
      await view.webContents.executeJavaScript(
        `document.documentElement.dataset.fusionTheme=${JSON.stringify(theme)};window.Appearance?.syncTheme(${JSON.stringify(theme === 'silver' ? 'professional' : theme)});`,
      );
    return { visible: true, section };
  }
  return Object.freeze({
    show,
    async runAction(action) {
      if (!Object.hasOwn(commonActions.elements, action))
        throw new PlatformError('INVALID_ACTION', '此公共操作不可用。');
      const captured = view;
      if (!captured || !visible || !controller.status().unlocked)
        throw new PlatformError('WORKSPACE_LOCKED', '请先打开对应的异常记录页面。');
      if (!ready)
        await new Promise((resolve) => {
          const finish = (ok) => {
            clearTimeout(timer);
            readyWaiters.delete(finish);
            resolve(ok);
          };
          const timer = setTimeout(() => finish(false), 6000);
          readyWaiters.add(finish);
        });
      if (
        captured !== view ||
        !ready ||
        !visible ||
        !controller.status().unlocked ||
        requestedSection !== commonActions.sections[action]
      )
        throw new PlatformError('SESSION_CHANGED', '页面已变化，请在当前页面重新选择操作。');
      try {
        return await captured.webContents.executeJavaScript(
          `window.LegacyCommonActions.activate(document, ${JSON.stringify(action)})`,
          true,
        );
      } catch {
        throw new PlatformError(
          'LEGACY_ACTION_UNAVAILABLE',
          '当前操作尚不可用，请检查当前页面和数据。',
        );
      }
    },
    activity: touch,
    hide() {
      generation++;
      visible = false;
      view?.setVisible(false);
      return { visible: false };
    },
    async flush() {
      if (!view || !ready) return true;
      const id = randomUUID();
      const ok = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          pendingFlush.delete(id);
          resolve(false);
        }, 7000);
        pendingFlush.set(id, (value) => {
          clearTimeout(timeout);
          resolve(value);
        });
        view.webContents.send('legacy:flush', id);
      });
      if (!ok)
        throw new PlatformError(
          'LEGACY_DRAFT_NOT_SAVED',
          '当前输入未能保存，请回到录入页检查后再关闭或锁定。',
        );
      return true;
    },
    destroyView,
    dispose() {
      disposed = true;
      clearInterval(idle);
      destroyView();
      for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
      for (const [channel, handler] of Object.entries(listeners))
        ipcMain.removeListener(channel, handler);
    },
  });
}
module.exports = { createLegacyHost, REGISTERED_CHANNELS };
