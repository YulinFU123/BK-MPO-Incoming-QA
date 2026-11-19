'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');

function harness() {
  const ipcMain = new EventEmitter();
  const handlers = new Map();
  ipcMain.handle = (name, handler) => handlers.set(name, handler);
  ipcMain.removeHandler = (name) => handlers.delete(name);
  const views = [];
  const actions = [];
  let unlocked = true;
  class View {
    constructor() {
      const content = new EventEmitter();
      content.mainFrame = { url: '' };
      content.setWindowOpenHandler = () => {};
      content.send = () => {};
      content.insertCSS = async () => {};
      content.executeJavaScript = async (script, gesture) => {
        if (script.startsWith('window.LegacyCommonActions.activate')) {
          actions.push({ script, gesture });
          return { requested: true };
        }
      };
      content.loadFile = async (file) => {
        content.mainFrame.url = pathToFileURL(file).href;
        content.emit('did-finish-load');
      };
      content.isDestroyed = () => this.closed === true;
      content.close = () => {
        this.closed = true;
      };
      this.webContents = content;
      views.push(this);
    }
    setBounds() {}
    setVisible(value) {
      this.visible = value;
    }
  }
  const entry = path.join(__dirname, '../desktop/legacy-host.js');
  const localRequire = (name) =>
    name === 'electron'
      ? { WebContentsView: View, ipcMain }
      : require(name.startsWith('.') ? path.resolve(path.dirname(entry), name) : name);
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(entry, 'utf8'),
    {
      require: localRequire,
      module,
      __dirname: path.dirname(entry),
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
      setImmediate,
    },
    { filename: entry },
  );
  const host = module.exports.createLegacyHost({
    window: {
      contentView: { addChildView() {}, removeChildView() {} },
      getContentSize: () => [1440, 900],
      isMaximized: () => false,
    },
    controller: { status: () => ({ unlocked }) },
    onLock() {},
  });
  const show = (section) =>
    host.show({ section, bounds: { x: 194, y: 64, width: 1200, height: 800 } });
  const ready = () => {
    const view = views.at(-1);
    ipcMain.emit('legacy:ready', {
      sender: view.webContents,
      senderFrame: view.webContents.mainFrame,
    });
  };
  return {
    host,
    show,
    ready,
    actions,
    views,
    lock: () => {
      unlocked = false;
      host.destroyView();
    },
  };
}

test('public operation waits for the original renderer and invokes exactly one fixed control with a user gesture', async () => {
  const h = harness();
  try {
    await h.show('records');
    const result = h.host.runAction('export-xlsx');
    assert.equal(h.actions.length, 0);
    h.ready();
    assert.equal((await result).requested, true);
    assert.equal(h.actions.length, 1);
    assert.match(h.actions[0].script, /activate\(document, "export-xlsx"\)/);
    assert.equal(h.actions[0].gesture, true);
    h.host.hide();
    await assert.rejects(h.host.runAction('export-xlsx'), { code: 'WORKSPACE_LOCKED' });
    await assert.rejects(h.host.runAction('delete'), { code: 'INVALID_ACTION' });
    assert.equal(h.actions.length, 1);
  } finally {
    h.host.dispose();
  }
});

test('pending public operation is rejected after a workspace lock or target-page change', async () => {
  for (const mode of ['lock', 'navigate']) {
    const h = harness();
    try {
      await h.show('records');
      const result = h.host.runAction('export-xlsx');
      const rejected = assert.rejects(result, { code: 'SESSION_CHANGED' });
      if (mode === 'lock') h.lock();
      else {
        await h.show('entry');
        h.ready();
      }
      await rejected;
      assert.equal(h.actions.length, 0);
    } finally {
      h.host.dispose();
    }
  }
});
