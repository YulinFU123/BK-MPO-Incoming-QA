'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { createRequire } = require('node:module'),
  { EventEmitter } = require('node:events');
const theme = require('../desktop/theme-contract');
const desktop = path.resolve(__dirname, '../desktop');
function rootNode() {
  const values = new Map();
  return {
    dataset: {},
    values,
    style: {
      setProperty(key, value, priority) {
        values.set(key, { value, priority });
      },
    },
  };
}
for (const name of theme.themes)
  test(`theme ${name} has identical semantic colors for home, recording and BI`, () => {
    const p = theme.palette(name),
      v = theme.variables(name);
    for (const key of ['--canvas', '--page', '--bg', '--hs-bg']) assert.equal(v[key], p.canvas);
    for (const key of [
      '--surface',
      '--panel',
      '--card',
      '--control',
      '--choice-layer',
      '--field-bg',
    ])
      assert.equal(v[key], p.surface);
    for (const key of ['--text', '--ink', '--txt', '--hs-text', '--choice-ink'])
      assert.equal(v[key], p.text);
    assert.deepEqual(theme.windowColors(name), { color: p.canvas, symbolColor: p.text });
  });
function luminance(hex) {
  const c = hex
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
function ratio(a, b) {
  const v = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (v[0] + 0.05) / (v[1] + 0.05);
}
test('text, placeholders, statuses and primary actions have measurable contrast in every palette', () => {
  for (const name of theme.themes) {
    const p = theme.palette(name);
    for (const background of [p.canvas, p.nav, p.surface, p.subtle]) {
      assert.ok(ratio(p.text, background) >= 4.5, `${name} normal text`);
      assert.ok(ratio(p.muted, background) >= 4.5, `${name} secondary text`);
    }
    assert.ok(ratio(p.accentInk, p.accent) >= 4.5, `${name} action`);
    for (const type of ['danger', 'warning', 'positive'])
      assert.ok(ratio(p[type], p[type + 'Soft']) >= 4.5, `${name} ${type}`);
  }
});
test('applying light-dark-light resets the whole document without sharing mutable state', () => {
  const root = rootNode();
  for (const value of ['silver', 'graphite', 'glass', 'contrast', 'silver']) {
    theme.applyDocument(root, value, 'legacy');
    for (const [key, color] of Object.entries(theme.variables(value)))
      assert.deepEqual(root.values.get(key), { value: color, priority: 'important' });
    assert.equal(root.dataset.uiTheme, value);
    assert.equal(root.dataset.themeSurface, 'legacy');
  }
  assert.equal(theme.normalize('professional'), 'silver');
  assert.equal(theme.normalize('unknown'), 'silver');
  assert.throws(() => theme.applyDocument(root, 'silver', 'unsupported'));
});
test('embedded scripts normalize untrusted themes, preserve appearance previews and honor forced colors', () => {
  for (const surface of ['legacy', 'bi']) {
    const root = rootNode();
    root.dataset.theme = 'glass';
    const context = {
      document: { documentElement: root },
      window: { WorkbenchTheme: theme, Appearance: { syncTheme() {} } },
      matchMedia: () => ({ matches: false }),
    };
    vm.runInNewContext(theme.embeddedScript('graphite', surface), context);
    assert.equal(root.dataset.uiTheme, surface === 'legacy' ? 'glass' : 'graphite');
    context.matchMedia = () => ({ matches: true });
    vm.runInNewContext(theme.embeddedScript('x";throw Error("injection")', surface), context);
    assert.equal(root.values.get('--surface').value, 'Canvas');
    assert.equal(root.values.get('--text').value, 'CanvasText');
  }
  assert.throws(() => theme.embeddedScript('silver', 'external'));
});
test('runtime observes the owning theme attribute and restores on preference changes', () => {
  for (const surface of ['shell', 'legacy', 'bi']) {
    const root = rootNode();
    root.dataset.themeSurface = surface;
    root.dataset.theme = 'graphite';
    root.dataset.fusionTheme = 'graphite';
    let changed, forcedChange, observed;
    const forced = {
      matches: false,
      addEventListener(_event, callback) {
        forcedChange = callback;
      },
    };
    vm.runInNewContext(fs.readFileSync(path.join(desktop, 'theme-runtime.js'), 'utf8'), {
      window: { WorkbenchTheme: theme },
      document: { documentElement: root },
      matchMedia: () => forced,
      MutationObserver: class {
        constructor(callback) {
          changed = callback;
        }
        observe(_root, options) {
          observed = options.attributeFilter;
        }
      },
    });
    assert.equal(root.values.get('--surface').value, theme.palette('graphite').surface);
    assert.equal(observed[0], surface === 'bi' ? 'data-fusion-theme' : 'data-theme');
    if (surface === 'bi') root.dataset.fusionTheme = 'silver';
    else root.dataset.theme = 'professional';
    changed();
    assert.equal(root.dataset.uiTheme, 'silver');
    forced.matches = true;
    forcedChange();
    assert.equal(root.values.get('--surface').value, 'Canvas');
  }
});
test('all live surfaces load the shared last layer and export paper keeps its own text colors', () => {
  const shell = fs.readFileSync(path.join(desktop, 'app/index.html'), 'utf8');
  assert.ok(shell.indexOf('theme-surfaces.css') > shell.indexOf('workspace-manager.css'));
  assert.ok(shell.indexOf('theme-contract.js') < shell.indexOf('renderer.js'));
  const prepare = fs.readFileSync(path.resolve(__dirname, '../scripts/prepare-bi.js'), 'utf8');
  for (const name of ['theme-contract.js', 'theme-runtime.js', 'theme-surfaces.css'])
    assert.ok(prepare.includes(name));
  const css = fs.readFileSync(path.join(desktop, 'bi-surface.css'), 'utf8');
  assert.ok(css.includes('svg:not([data-ui-paper]) text'));
  assert.ok(
    fs
      .readFileSync(path.join(desktop, 'bi-fusion.js'), 'utf8')
      .includes("graphic.dataset.uiPaper='true'"),
  );
});

// Host lifecycle simulation only. No browser, Electron window, worker, real user
// data or policy settings are opened. It tests load/theme/visibility ordering.
function simulatedHost(kind) {
  let sessionId = 'synthetic';
  const navigations = [];
  const events = [],
    views = [];
  const ipc = new EventEmitter();
  ipc.handle = () => {};
  ipc.removeHandler = () => {};
  class Contents extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
    }
    setWindowOpenHandler() {}
    isDestroyed() {
      return this.destroyed;
    }
    close() {
      this.destroyed = true;
    }
    send() {}
    loadFile(file) {
      this.mainFrame = { url: require('node:url').pathToFileURL(file).href };
      return new Promise((resolve) => {
        this.finish = () => {
          this.emit('did-finish-load');
          resolve();
        };
      });
    }
    async insertCSS() {
      events.push('css');
      if (this.rejectCss) throw Error('synthetic stylesheet failure');
    }
    async executeJavaScript(code) {
      if (code.includes('window.InsightSummary = Object.freeze')) {
        // Model the completion-value IPC serialization; executing the script
        // alone misses the failure caused by exporting functions as the result.
        structuredClone(vm.runInNewContext(code, { window: {} }));
      }
      if (code.startsWith('(()=>{const root=document.documentElement;root.dataset.fusionTheme=')) {
        events.push(code.includes('fusionTheme="graphite"') ? 'theme:graphite' : 'theme:silver');
        if (this.rejectTheme) throw Error('synthetic theme failure');
      }
    }
  }
  class View {
    constructor() {
      this.webContents = new Contents();
      views.push(this);
    }
    setVisible(value) {
      events.push('visible:' + value);
    }
    setBounds() {}
  }
  const file = path.join(desktop, kind + '-host.js'),
    localRequire = createRequire(file),
    out = { exports: {} };
  const context = {
    require(name) {
      if (name === 'electron') return { WebContentsView: View, ipcMain: ipc };
      if (name === 'node:fs')
        return { ...fs, existsSync: (file) => file.endsWith('python.exe') || fs.existsSync(file) };
      if (name === 'node:fs/promises')
        return { ...require('node:fs/promises'), mkdir: async () => {} };
      if (name === './bi-client')
        return { startBIWorker: () => ({ ready: Promise.resolve(), abort() {} }) };
      return localRequire(name);
    },
    module: out,
    exports: out.exports,
    __dirname: desktop,
    setInterval: () => ({ unref() {} }),
    clearInterval() {},
    setTimeout,
    clearTimeout,
    setImmediate,
    console,
  };
  const hostSource =
    kind === 'legacy' && process.env.PLATFORM_TEST_LEGACY_HOST_SOURCE
      ? path.resolve(process.env.PLATFORM_TEST_LEGACY_HOST_SOURCE)
      : file;
  vm.runInNewContext(fs.readFileSync(hostSource, 'utf8'), context, { filename: hostSource });
  const host = out.exports[kind === 'legacy' ? 'createLegacyHost' : 'createBIHost']({
    window: {
      contentView: { addChildView() {}, removeChildView() {} },
      getContentSize: () => [1200, 800],
    },
    controller: {
      status: () => ({ unlocked: true }),
      hostContext: () => ({
        unlocked: true,
        sessionId,
        mode: 'file',
        file: 'synthetic-unwritten-workspace',
      }),
    },
    profile: 'synthetic-unwritten-profile',
    onLock() {},
    onNavigate: (route) => navigations.push(route),
  });
  return {
    host,
    events,
    views,
    ipc,
    navigations,
    section: kind === 'legacy' ? 'entry' : 'daily',
    setSession: (value) => {
      sessionId = value;
    },
  };
}
test('BI navigation requests accept only the owned frame and known destinations, then dispose cleanly', async () => {
  const f = simulatedHost('bi');
  try {
    const shown = f.host.show({
      section: 'daily',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });
    await turn();
    f.views[0].webContents.finish();
    await shown;
    const content = f.views[0].webContents,
      event = { sender: content, senderFrame: content.mainFrame };
    f.ipc.emit('bi:navigate-request', event, 'center');
    f.ipc.emit('bi:navigate-request', event, 'data');
    f.ipc.emit('bi:navigate-request', event, '../../secret');
    f.ipc.emit('bi:navigate-request', { sender: {}, senderFrame: content.mainFrame }, 'home');
    f.ipc.emit(
      'bi:navigate-request',
      { sender: content, senderFrame: { url: content.mainFrame.url } },
      'home',
    );
    assert.deepEqual(f.navigations, ['bi-center', 'bi-data']);
  } finally {
    f.host.dispose();
  }
  assert.equal(f.ipc.listenerCount('bi:navigate-request'), 0);
});
test('BI host cannot reuse an earlier workspace worker after the session changes', async () => {
  const f = simulatedHost('bi');
  try {
    const input = { section: 'daily', bounds: { x: 0, y: 0, width: 800, height: 600 } };
    const shown = f.host.show(input);
    await turn();
    f.views[0].webContents.finish();
    await shown;
    f.setSession('other-workspace');
    await assert.rejects(f.host.show(input), (error) => error.code === 'SESSION_CHANGED');
  } finally {
    f.host.dispose();
  }
});
test('legacy discards a failed initial view and permits retry without restarting the controller', async () => {
  const f = simulatedHost('legacy');
  const input = {
    section: 'records',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    theme: 'graphite',
  };
  try {
    const failed = f.host.show(input);
    await turn();
    f.views[0].webContents.rejectCss = true;
    f.views[0].webContents.finish();
    await assert.rejects(
      failed,
      (error) => error.code === 'LEGACY_VIEW_LOAD_FAILED' && error.message.includes('页面样式'),
    );
    assert.ok(f.views[0].webContents.isDestroyed());
    const retry = f.host.show(input);
    await turn();
    assert.equal(f.views.length, 2);
    f.views[1].webContents.finish();
    assert.equal((await retry).visible, true);
    for (const section of ['entry', 'records', 'followup', 'analysis', 'settings', 'appearance']) {
      assert.equal((await f.host.show({ ...input, section })).section, section);
    }
    assert.equal(f.views.length, 2, 'navigation must reuse the successfully initialized view');
  } finally {
    f.host.dispose();
  }
});
const turn = () => new Promise((resolve) => setImmediate(resolve));
for (const kind of ['legacy', 'bi']) {
  test(`${kind} waits for shared loading and the latest theme before revealing a view`, async () => {
    const f = simulatedHost(kind),
      input = { section: f.section, bounds: { x: 200, y: 70, width: 1000, height: 700 } };
    try {
      const first = f.host.show({ ...input, theme: 'graphite' });
      await turn();
      const second = f.host.show({ ...input, theme: 'silver' });
      await turn();
      assert.equal(f.views.length, 1);
      assert.deepEqual(f.events, ['visible:false']);
      f.views[0].webContents.finish();
      assert.equal((await first).cancelled, true);
      assert.equal((await second).visible, true);
      assert.deepEqual(f.events.slice(-2), ['theme:silver', 'visible:true']);
      assert.equal(f.events.filter((x) => x === 'visible:true').length, 1);
    } finally {
      f.host.dispose();
    }
  });
  test(`${kind} cannot reveal a view hidden during load`, async () => {
    const f = simulatedHost(kind);
    try {
      const pending = f.host.show({
        section: f.section,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        theme: 'graphite',
      });
      await turn();
      f.host.hide();
      f.views[0].webContents.finish();
      assert.equal((await pending).cancelled, true);
      assert.ok(!f.events.includes('visible:true'));
    } finally {
      f.host.dispose();
    }
  });
  test(`${kind} reports failed theme application without revealing the unthemed view`, async () => {
    const f = simulatedHost(kind);
    try {
      const pending = f.host.show({
        section: f.section,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        theme: 'graphite',
      });
      await turn();
      f.views[0].webContents.rejectTheme = true;
      f.views[0].webContents.finish();
      await assert.rejects(pending, /synthetic theme failure/);
      assert.ok(!f.events.includes('visible:true'));
    } finally {
      f.host.dispose();
    }
  });
}
