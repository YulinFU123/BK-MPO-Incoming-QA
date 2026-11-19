'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const N = require('../desktop/app/navigation-model');

function dom() {
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this._text = '';
      this.style = { setProperty() {} };
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.listeners = {};
    }
    get textContent() {
      return this._text + this.children.map((n) => n.textContent).join(' ');
    }
    set textContent(v) {
      this._text = String(v);
      this.children = [];
    }
    append(...nodes) {
      for (const n of nodes) {
        if (n.parent) n.parent.children = n.parent.children.filter((x) => x !== n);
        n.parent = this;
        this.children.push(n);
      }
    }
    prepend(...nodes) {
      for (const n of [...nodes].reverse()) {
        if (n.parent) n.parent.children = n.parent.children.filter((x) => x !== n);
        n.parent = this;
        this.children.unshift(n);
      }
    }
    replaceChildren(...nodes) {
      this.children.forEach((n) => {
        n.parent = null;
      });
      this.children = [];
      this._text = '';
      this.append(...nodes);
    }
    get firstElementChild() {
      return this.children[0];
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === 'hidden') this.hidden = true;
    }
    removeAttribute(k) {
      delete this.attributes[k];
    }
    after(n) {
      const p = this.parent;
      n.parent = p;
      p.children.splice(p.children.indexOf(this) + 1, 0, n);
    }
    before(n) {
      const p = this.parent;
      n.parent = p;
      p.children.splice(p.children.indexOf(this), 0, n);
    }
    closest(tag) {
      for (let p = this; p; p = p.parent) if (p.tagName === tag) return p;
      return null;
    }
    addEventListener(k, fn) {
      (this.listeners[k] ||= []).push(fn);
    }
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
      for (const fn of this.listeners.close || []) fn();
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((n) => n !== this);
      this.parent = null;
    }
    focus() {}
    scrollIntoView() {}
    querySelectorAll() {
      return [];
    }
  }
  const body = new Element('body'),
    all = () => {
      const walk = (n) => [n, ...n.children.flatMap(walk)];
      return walk(body);
    };
  const add = (id, tag = 'div') => {
    const n = new Element(tag);
    n.id = id;
    body.append(n);
    return n;
  };
  const document = {
    body,
    createElement: (t) => new Element(t),
    createElementNS: (_ns, t) => new Element(t),
    getElementById: (id) => all().find((n) => n.id === id),
    querySelector: (selector) => (selector === '[data-page="home"]' ? home : null),
    querySelectorAll: () => [],
  };
  const home = add('homePage', 'section');
  return { Element, document, body, all, add };
}
function load(name, context) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../desktop/app', name), 'utf8'), context);
}

test('source choice controls the entire directory/search/action graph while preserving every old function', () => {
  const bi = N.search('', 'bi');
  for (const id of [
    'legacy-entry',
    'legacy-records',
    'legacy-followup',
    'legacy-analysis',
    'legacy-settings',
    'import',
    'overview',
    'data',
    'batch-scan',
    'import-record-xlsx',
  ])
    assert(!bi.some((x) => x.id === id), id);
  const records = N.search('', 'records');
  for (const id of ['analysis-studio', 'bi-center', ...Object.keys(N.biSections)])
    assert(!records.some((x) => x.id === id), id);
  for (const mode of ['records', 'bi'])
    for (const id of ['home', 'label-studio', 'legacy-appearance', 'security'])
      assert(N.allows(id, mode), mode + id);
  for (const id of Object.keys(N.biSections)) assert(N.allows(id, 'bi'), id);
  for (const mode of ['records', 'bi', 'auto'])
    for (const route of N.search('', mode))
      assert(N.allows(route.kind === 'action' ? route.route : route.id, mode));
  assert.equal(N.safeRoute('legacy-records', 'bi'), 'home');
  assert.equal(N.safeRoute('bi-trends', 'records'), 'home');
  assert.equal(N.safeRoute('label-studio', 'bi'), 'label-studio');
  assert(!N.destinationAllowed('action:batch-scan', 'bi'));
  assert.equal(N.search('').length, 42, 'all compatibility routes remain registered');
});

test('actual homepage sidebar and global buttons switch together without exposing the opposite workflow', async () => {
  const d = dom();
  for (const id of ['primaryNavigation', 'toolbarImport']) d.add(id);
  let mode = 'bi';
  const actions = [],
    rows = new Map();
  const defaults = {
    'home-workspaces-v2': require('../domain/home-workspaces').defaults(),
    'home-navigation': { expanded: ['records', 'analysis', 'data', 'system'] },
    'home-data-source': { mode: 'bi', channel: 'studio', dailyScope: '', employee: '' },
  };
  const context = vm.createContext({
    window: {
      WorkspaceQuery: require('../domain/workspace-query'),
      HomeWorkspaces: require('../domain/home-workspaces'),
      HomeGraphics: {},
      WorkbenchNavigation: N,
      createModuleStateClient: () => ({
        open: async (a) => ({
          data: structuredClone(rows.get(a.module) || defaults[a.module]),
          revision: 1,
        }),
        change: (a, v) => rows.set(a.module, structuredClone(v)),
        flush: async () => {},
      }),
    },
    document: d.document,
    ResizeObserver: class {
      observe() {}
    },
    structuredClone,
    setTimeout,
    clearTimeout,
    cancelAnimationFrame() {},
    requestAnimationFrame() {},
  });
  load('home-studio.js', context);
  const ui = context.window.createHomeStudio({
    api: async () => {},
    getContext: () => ({ dataSourceMode: mode }),
    onNavigate: (x) => actions.push(x),
    onAction: (x) => actions.push(x),
    onAnalysisTab: (x) => actions.push(x),
  });
  await ui.prepare();
  const nav = () => d.document.getElementById('hsNavigation').textContent,
    tools = () => d.document.getElementById('hsGlobalTools').textContent;
  assert(!/快捷录入|记录查询|待办跟进|异常表头|检验导入/.test(nav()));
  assert.match(nav(), /BI工作台/);
  assert.doesNotMatch(nav(), /BI自由分析/);
  assert.match(nav(), /夹具标签/);
  assert(!/新建记录|扫码|待办/.test(tools()));
  assert.match(tools(), /BI数据与导入.*日周月分析.*横向A4报告/);
  const importButton = d
    .all()
    .find((n) => n.tagName === 'button' && n.textContent === 'BI数据与导入');
  importButton.onclick();
  assert.deepEqual(actions, ['sources']);
  mode = 'records';
  ui.setRoute('home');
  assert(!/BI自由分析|BI工作台/.test(nav()));
  assert.match(nav(), /快捷录入.*记录查询.*待办跟进/);
  assert.match(tools(), /新建记录.*扫码.*待办跟进/);
  assert(!/BI数据与导入/.test(tools()));
});

test('actual function search and directory hubs filter routes again after a workspace switch', async () => {
  const d = dom();
  for (const id of [
    'primaryNavigation',
    'homeMain',
    'homeAside',
    'analysisMain',
    'analysisAside',
    'dataImports',
    'dataRules',
    'settingsMain',
    'settingsAside',
    'toolbarImport',
    'toolbarSecondary',
    'homeWorkspace',
    'functionQuery',
    'functionResults',
    'functionEmpty',
    'functionCount',
    'functionDialog',
    'functionClose',
    'openFunctions',
    'workspaceView',
  ])
    d.add(id);
  let mode = 'bi';
  const opened = [];
  const context = vm.createContext({
    window: { WorkbenchNavigation: N, BIWorkflow: require('../domain/bi-workflow') },
    document: d.document,
  });
  load('navigation-ui.js', context);
  const ui = context.window.createWorkspaceNavigation({
    status: () => ({ dataSourceMode: mode }),
    view: () => 'home',
    navigate: (id, options) => opened.push(options?.analysisTab ? id + ':' + options.analysisTab : id),
    act: (id) => opened.push(id),
    beforeSearch: async () => {},
    afterSearch() {},
  });
  ui.init();
  ui.setEnabled(true);
  ui.setView();
  const [history] = ui.renderBiTools().children;
  const options = history.children
    .filter((group) => group.tagName === 'optgroup')
    .flatMap((group) => group.children.map((option) => option.value));
  assert.deepEqual(
    options.sort(),
    Object.keys(N.biSections).sort(),
  );
  history.value = 'bi-trends';
  history.onchange();
  assert.deepEqual(opened, ['bi-trends']);
  assert.equal(history.value, '');
  await ui.openSearch();
  const destinations = () =>
    d
      .all()
      .filter((n) => n.dataset.destination)
      .map((n) => n.dataset.destination);
  assert(destinations().every((id) => N.destinationAllowed(id, 'bi')));
  assert(!d.document.getElementById('functionResults').textContent.includes('批量扫码'));
  d.document.getElementById('functionDialog').close();
  mode = 'records';
  ui.setView();
  assert.equal(ui.renderBiTools().children.length, 0);
  history.value = 'bi-trends';
  history.onchange();
  assert.deepEqual(opened, ['bi-trends']);
  await ui.openSearch();
  assert(destinations().every((id) => N.destinationAllowed(id, 'records')));
  assert(!d.document.getElementById('functionResults').textContent.includes('BI自由分析'));
});

test('source picker requires an explicit choice and cancellation never invents a selection', async () => {
  const d = dom(),
    context = vm.createContext({ window: {}, document: d.document });
  load('source-choice.js', context);
  const selected = context.window.chooseWorkspaceSource({ name: '旧工作区' });
  const bi = d.all().find((n) => n.dataset.sourceMode === 'bi');
  bi.onclick();
  assert.equal(await selected, 'bi');
  const cancelled = context.window.chooseWorkspaceSource();
  d.all()
    .find((n) => n.tagName === 'dialog')
    .close();
  assert.equal(await cancelled, null);
});

test('a stale manual shortcut in a BI workspace performs no operation', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../desktop/app/renderer.js'), 'utf8');
  const body = source.slice(
    source.indexOf('  async function executeCommon('),
    source.indexOf('  async function hideLegacy('),
  );
  let calls = 0;
  const context = vm.createContext({
    navigation: N,
    state: { status: { unlocked: true, dataSourceMode: 'bi' } },
    showView() {
      calls++;
    },
    openImport() {
      calls++;
    },
    updateLegacyLayout() {
      calls++;
    },
    api() {
      calls++;
    },
  });
  vm.runInContext(body + '\nthis.execute=executeCommon;', context);
  await context.execute('batch-scan');
  await context.execute('import-quantity');
  assert.equal(calls, 0);
});
