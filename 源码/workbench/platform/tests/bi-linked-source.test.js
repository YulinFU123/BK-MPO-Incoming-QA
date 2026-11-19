'use strict';
// The BI panel's source folder is linked to the main window's import folder.
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  fsp = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  vm = require('node:vm');
const { createRequire } = require('node:module'),
  { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const desktop = path.resolve(__dirname, '../desktop');
const appRoot = path.resolve(desktop, '../..');
const uiUrl = pathToFileURL(path.join(appRoot, 'bi-ui', 'index.html')).href;

function simulatedHost({ downloadFolder, sources, activeSource, corrupt = false, panelFieldmap = {} }) {
  const calls = [];
  const ipc = new EventEmitter();
  let requestHandler = null;
  ipc.handle = (channel, handler) => {
    if (channel === 'bi:request') requestHandler = handler;
  };
  ipc.removeHandler = () => {};
  const opened = [];
  const shell = { openPath: async (target) => { opened.push(target); return ''; } };
  const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
  class Contents extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
    }
    setWindowOpenHandler() {}
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; }
    send() {}
    loadFile(file) {
      this.mainFrame = { url: pathToFileURL(file).href };
      return new Promise((resolve) => {
        this.finish = () => { this.emit('did-finish-load'); resolve(); };
      });
    }
    async insertCSS() {}
    async executeJavaScript() {}
  }
  class View {
    constructor() { this.webContents = new Contents(); views.push(this); }
    setVisible() {}
    setBounds() {}
  }
  const views = [];
  const instance = {
    ready: Promise.resolve(),
    abort() {},
    async request(message) {
      calls.push(message);
      if (message.control === 'grant') return true;
      if (message.route === '/api/state') {
        return {
          config: {
            version: 9,
            fieldmap: structuredClone(panelFieldmap),
            paths: { input: '每日原表', history: '历史数据库', output: '分析结果', pattern: 'data*.xlsx' },
            P: { '导入后归档原表': '是' },
          },
          first_run: false,
          base: dataRoot,
        };
      }
      return { ok: true };
    },
  };
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-linked-ws-'));
  const dataRoot = workspace + '.bi-data';
  fs.mkdirSync(dataRoot, { recursive: true });
  const moduleState = {
    readModuleState: async (address) => {
      // The address crosses a vm realm, so compare primitives, not prototypes.
      assert.equal(String(address.scope), 'module');
      assert.equal(String(address.module), 'analysis-studio');
      return { corrupt, data: { sources, activeSource }, revision: 1 };
    },
  };
  const file = path.join(desktop, 'bi-host.js'),
    localRequire = createRequire(file),
    out = { exports: {} };
  const context = {
    require(name) {
      if (name === 'electron') return { WebContentsView: View, ipcMain: ipc, dialog, shell };
      if (name === 'node:fs')
        return { ...fs, existsSync: (target) => String(target).endsWith('python.exe') || fs.existsSync(target) };
      if (name === 'node:fs/promises')
        return { ...require('node:fs/promises'), mkdir: async () => {} };
      if (name === './bi-client') return { startBIWorker: () => instance };
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
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const host = out.exports.createBIHost({
    window: {
      contentView: { addChildView() {}, removeChildView() {} },
      getContentSize: () => [1200, 800],
    },
    controller: {
      status: () => ({ unlocked: true }),
      hostContext: () => ({ unlocked: true, sessionId: 'synthetic', mode: 'file', file: workspace }),
    },
    moduleState,
    profile: path.join(os.tmpdir(), 'bi-linked-profile'),
    qa: false,
  });
  const cleanup = () => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  };
  return { host, views, calls, opened, requestHandler, cleanup, downloadFolder, uiUrl };
}

async function openPanel(f) {
  const shown = f.host.show({ section: 'daily', bounds: { x: 0, y: 0, width: 800, height: 600 } });
  await new Promise((resolve) => setImmediate(resolve));
  f.views[0].webContents.finish();
  await shown;
  const contents = f.views[0].webContents;
  return { sender: contents, senderFrame: contents.mainFrame };
}

function source(folder, id = 'defects-1', mapping = null, columns = null) {
  return { id, name: 'BI不良数据', kind: 'defects', confirmed: true, folder,
    ...(mapping ? { mapping } : {}), ...(columns ? { columns } : {}) };
}

test('linked download folder is injected into /api/state and granted read-only', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-linked-dl-'));
  const f = simulatedHost({ downloadFolder: folder, sources: [source(folder)], activeSource: 'defects-1' });
  t.after(() => { f.cleanup(); fs.rmSync(folder, { recursive: true, force: true }); });
  const event = await openPanel(f);
  const response = await f.requestHandler(event, { route: '/api/state' });
  assert.equal(response.ok, true);
  const state = response.value;
  assert.equal(state.config.paths.input, fs.realpathSync(folder));
  assert.equal(state.linkedSource, fs.realpathSync(folder));
  assert.equal(state.config.paths.pattern, '*.xlsx');
  // Archiving would move originals out of the shared folder.
  assert.equal(state.config.P['导入后归档原表'], '否');
  const grants = f.calls.filter((call) => call.control === 'grant');
  assert.equal(grants.length, 1);
  assert.equal(grants[0].path, fs.realpathSync(folder));
  assert.notEqual(grants[0].write, true);
});

test('no confirmed defects source leaves the default 每日原表 untouched', async (t) => {
  const f = simulatedHost({ sources: [], activeSource: '' });
  t.after(f.cleanup);
  const event = await openPanel(f);
  const response = await f.requestHandler(event, { route: '/api/state' });
  assert.equal(response.ok, true);
  assert.equal(response.value.config.paths.input, '每日原表');
  assert.equal(response.value.linkedSource, undefined);
  assert.equal(response.value.config.paths.pattern, 'data*.xlsx');
  assert.equal(f.calls.filter((call) => call.control === 'grant').length, 0);
});

test('relative or unconfirmed folder is ignored', async (t) => {
  const f = simulatedHost({
    sources: [
      { ...source('relative/folder', 'a'), confirmed: false },
      { ...source('每日原表', 'b'), confirmed: true },
    ],
    activeSource: 'b',
  });
  t.after(f.cleanup);
  const event = await openPanel(f);
  const response = await f.requestHandler(event, { route: '/api/state' });
  assert.equal(response.value.config.paths.input, '每日原表');
  assert.equal(f.calls.filter((call) => call.control === 'grant').length, 0);
});

test('corrupt module state falls back safely', async (t) => {
  const f = simulatedHost({ sources: [source('/nonexistent')], activeSource: 'defects-1', corrupt: true });
  t.after(f.cleanup);
  const event = await openPanel(f);
  const response = await f.requestHandler(event, { route: '/api/state' });
  assert.equal(response.ok, true);
  assert.equal(response.value.config.paths.input, '每日原表');
});

test('opening the input folder resolves to the linked download folder', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-linked-dl-'));
  const f = simulatedHost({ downloadFolder: folder, sources: [source(folder)], activeSource: 'defects-1' });
  t.after(() => { f.cleanup(); fs.rmSync(folder, { recursive: true, force: true }); });
  const event = await openPanel(f);
  const linked = fs.realpathSync(folder);
  const response = await f.requestHandler(event, {
    route: '/api/open',
    body: { what: 'input', config: { paths: { input: linked } } },
  });
  assert.equal(response.ok, true);
  assert.deepEqual(f.opened, [linked]);
});

// The header configured in "BI数据与导入" is inherited by the daily report,
// so the same columns never need to be mapped a second time.
const IMPORT_COLUMNS = [
  { id: 'h_date', label: 'Work Date', type: 'date' },
  { id: 'h_emp', label: 'Employee in Charge', type: 'text' },
  { id: 'h_proc', label: 'Workflow Step in Charge', type: 'text' },
  { id: 'h_def', label: 'Defect Code', type: 'text' },
  { id: 'h_qty', label: 'Sum of Qty', type: 'number' },
  { id: 'h_floor', label: '楼层', type: 'text' },
];
const IMPORT_MAPPING = {
  date: 'h_date', employee: 'h_emp', process: 'h_proc',
  defect: 'h_def', quantity: 'h_qty', floor: 'h_floor',
};

test('imported header mapping is inherited into the daily report config', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-linked-dl-'));
  const src = source(folder, 'defects-1', IMPORT_MAPPING, IMPORT_COLUMNS);
  const f = simulatedHost({ downloadFolder: folder, sources: [src], activeSource: 'defects-1' });
  t.after(() => { f.cleanup(); fs.rmSync(folder, { recursive: true, force: true }); });
  const event = await openPanel(f);
  const response = await f.requestHandler(event, { route: '/api/state' });
  assert.equal(response.ok, true);
  const fm = response.value.config.fieldmap;
  assert.equal(fm['Work Date'].role, '业务日期');
  assert.equal(fm['Employee in Charge'].role, '责任员工');
  // Standard header text wins: the daily engine maps this column to 责任站点,
  // even though the import role is generically called "process".
  assert.equal(fm['Workflow Step in Charge'].role, '责任站点');
  assert.equal(fm['Defect Code'].role, '不良代码');
  assert.equal(fm['Sum of Qty'].role, '数量');
  // floor has no BI equivalent and must not be injected as a bogus role.
  assert.equal(fm['楼层'], undefined);
  assert.equal(response.value.inheritedFieldmap['Defect Code'], '不良代码');
});

test('a role the user set inside the daily panel is never overwritten', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-linked-dl-'));
  const src = source(folder, 'defects-1', IMPORT_MAPPING, IMPORT_COLUMNS);
  const panelFieldmap = { 'Defect Code': { role: '不良大类', show: true } };
  const f = simulatedHost({ downloadFolder: folder, sources: [src], activeSource: 'defects-1', panelFieldmap });
  t.after(() => { f.cleanup(); fs.rmSync(folder, { recursive: true, force: true }); });
  const event = await openPanel(f);
  const response = await f.requestHandler(event, { route: '/api/state' });
  const fm = response.value.config.fieldmap;
  assert.equal(fm['Defect Code'].role, '不良大类', '手动选的角色应保留');
  assert.equal(response.value.inheritedFieldmap['Defect Code'], undefined);
  // Other unmapped columns are still inherited.
  assert.equal(fm['Employee in Charge'].role, '责任员工');
});

test('saving strips inherited mapping so config.json stays a single source of truth', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-linked-dl-'));
  const src = source(folder, 'defects-1', IMPORT_MAPPING, IMPORT_COLUMNS);
  const f = simulatedHost({ downloadFolder: folder, sources: [src], activeSource: 'defects-1' });
  t.after(() => { f.cleanup(); fs.rmSync(folder, { recursive: true, force: true }); });
  const event = await openPanel(f);
  await f.requestHandler(event, { route: '/api/state' });
  const manual = { 'Defect Code': { role: '不良大类', show: true } };
  const config = {
    fieldmap: {
      ...manual,
      'Work Date': { role: '业务日期', show: true },
      'Employee in Charge': { role: '责任员工', show: true },
    },
    paths: { input: folder }, P: {},
  };
  const saved = await f.requestHandler(event, { route: '/api/save', body: { config } });
  assert.equal(saved.ok, true);
  const persisted = f.calls.filter((c) => c.route === '/api/save').at(-1).body.config.fieldmap;
  assert.equal(persisted['Work Date'].role, '不使用', '继承的列不应写盘');
  assert.equal(persisted['Employee in Charge'].role, '不使用', '继承的列不应写盘');
  assert.equal(persisted['Defect Code'].role, '不良大类', '用户手动选的应写盘');
});

test('no import mapping leaves the daily fieldmap untouched', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-linked-dl-'));
  const src = source(folder); // no mapping/columns yet
  const panelFieldmap = { 'Work Date': { role: '业务日期', show: true } };
  const f = simulatedHost({ downloadFolder: folder, sources: [src], activeSource: 'defects-1', panelFieldmap });
  t.after(() => { f.cleanup(); fs.rmSync(folder, { recursive: true, force: true }); });
  const event = await openPanel(f);
  const response = await f.requestHandler(event, { route: '/api/state' });
  assert.equal(response.value.config.fieldmap['Work Date'].role, '业务日期');
  assert.equal(response.value.inheritedFieldmap, null);
});

test('non-standard Chinese headers fall back to the import role', async (t) => {
  // Panel auto-detection (ROLE_DEFAULT) only knows standard BI headers. When the
  // user's export has Chinese headers, the role chosen during import is the only
  // reliable signal, so it must still be carried over.
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-linked-dl-'));
  const columns = [
    { id: 'c1', label: '生产日期', type: 'date' },
    { id: 'c2', label: '作业员', type: 'text' },
    { id: 'c3', label: '不良现象', type: 'text' },
  ];
  const mapping = { date: 'c1', employee: 'c2', defect: 'c3' };
  const src = source(folder, 'defects-1', mapping, columns);
  const f = simulatedHost({ downloadFolder: folder, sources: [src], activeSource: 'defects-1' });
  t.after(() => { f.cleanup(); fs.rmSync(folder, { recursive: true, force: true }); });
  const event = await openPanel(f);
  const response = await f.requestHandler(event, { route: '/api/state' });
  const fm = response.value.config.fieldmap;
  assert.equal(fm['生产日期'].role, '业务日期');
  assert.equal(fm['作业员'].role, '责任员工');
  assert.equal(fm['不良现象'].role, '不良代码');
});
