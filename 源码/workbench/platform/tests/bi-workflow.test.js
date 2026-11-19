'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const path = require('node:path'),
  fs = require('node:fs'),
  vm = require('node:vm');
const model = require('../domain/bi-workflow'),
  navigation = require('../desktop/app/navigation-model');
const { BI_PAGES } = require('../desktop/bi-host'),
  state = require('../domain/module-state');
const { filterMemory } = require('../desktop/bi-filter-state');
test('one workflow catalog retains all 14 BI pages with stable IDs and a separate native center', () => {
  assert.equal(new Set(model.pages).size, 14);
  assert.deepEqual([...model.pages].sort(), BI_PAGES.map((x) => 'bi-' + x).sort());
  assert.ok(navigation.getRoute('bi-center'));
  assert.equal(navigation.biSections['bi-center'], undefined);
  for (const route of model.pages) assert.ok(navigation.getRoute(route));
  assert.ok(navigation.search('日报与邮件素材').some((x) => x.id === 'bi-daily'));
});
test('receiving recent data preserves the current disposition, filters and original object', () => {
  for (const status of ['Rework,Scrap', 'Scrap', '']) {
    const current = {
      scope: 'old',
      start: '2026-01-01',
      end: '2026-01-02',
      status,
      items: ['装管反'],
      employees: ['合成人员'],
    };
    const before = structuredClone(current);
    const result = model.latestQuery(current, {
      scope: 'new',
      period: { start: '2026-10-29', end: '2026-10-30' },
    });
    assert.equal(result.status, status);
    assert.equal(result.scope, 'new');
    assert.deepEqual(result.items, ['装管反']);
    result.items.push('断裂');
    assert.deepEqual(current, before);
  }
  assert.throws(() => model.latestQuery({}, {}));
});
test('range summaries distinguish daily, historical trends and full report windows', () => {
  const daily = {
    start: '2026-10-29',
    end: '2026-10-30',
    scope: 'Synthetic floor',
    status: 'Scrap',
    items: ['装管反'],
    employees: ['甲'],
    exclude: ['乙'],
    floor: ['BK5F'],
  };
  const a = model.context({ page: 'daily', daily });
  assert.equal(a.lane, '日报数据');
  assert.equal(a.status, '报废');
  assert.match(a.filters, /排除人员：乙/);
  assert.match(a.filters, /楼层：BK5F/);
  const b = model.context({
    page: 'trends',
    history: { start: '2026-01-01', end: '2026-01-02', items: ['断裂'] },
    dirty: true,
  });
  assert.equal(b.lane, '历史数据');
  assert.match(b.range, /2026-01-01/);
  assert.match(b.notice, /更新分析/);
  const c = model.context({ page: 'home', history: { start: '2000-01-01', end: '2000-01-02' } });
  assert.ok(!c.range.includes('2000'));
  assert.match(c.range, /不套用趋势/);
});
test('workflow memory is additive, workspace scoped and cannot accept business records', async () => {
  const address = { scope: 'module', module: 'bi-workflow' };
  assert.deepEqual(state.validate(address, {}), { acquisitionOpen: false, scriptOpen: false });
  assert.deepEqual(state.validate(address, { acquisitionOpen: true }), {
    acquisitionOpen: true,
    scriptOpen: false,
  });
  assert.throws(() => state.validate(address, { records: [] }));
  const calls = [],
    host = { readModuleState: async (a) => calls.push(a) };
  await filterMemory(host, { action: 'read' }, address);
  assert.deepEqual(calls, [address]);
  await assert.rejects(
    filterMemory(host, { action: 'read', address: { scope: 'global' } }, address),
  );
});

function domHarness(options = {}) {
  const nodes = [],
    events = new Map(),
    requests = [],
    navigations = [],
    microtasks = [];
  let saved = model.preferences(options.initial || {}),
    revision = 0,
    releaseRead;
  class Node {
    constructor(tag, cls = '') {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.listeners = new Map();
      this.classes = new Set(cls.split(' '));
      this.classList = { add: (...values) => values.forEach((x) => this.classes.add(x)) };
      nodes.push(this);
    }
    append(...children) {
      for (const child of children) {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        child.parent = this;
        this.children.push(child);
      }
    }
    replaceChildren(...children) {
      for (const child of this.children) child.parent = null;
      this.children = [];
      this.append(...children);
    }
    before(node) {
      const parent = this.parent;
      if (parent) {
        node.parent = parent;
        parent.children.splice(parent.children.indexOf(this), 0, node);
      }
    }
    contains(node) {
      return (
        node === 'page-field' ||
        this.children.some((child) => child === node || child.contains(node))
      );
    }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(selector === 'button' && child.tagName === 'BUTTON' ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
    click() {
      return this.onclick?.();
    }
    scrollIntoView() {
      this.scrolled = true;
    }
    get childNodes() {
      return this.children;
    }
    set className(value) {
      this.classes = new Set(value.split(' '));
    }
    get className() {
      return [...this.classes].join(' ');
    }
    addEventListener(name, fn) {
      this.listeners.set(name, fn);
    }
    setAttribute(key, value) {
      this[key] = value;
    }
    querySelector(selector) {
      return selector === ':scope > summary'
        ? this.children.find((n) => n.tagName === 'SUMMARY')
        : this.children.find((n) => n.classes.has(selector.slice(1)));
    }
  }
  const box = new Node('details'),
    summary = new Node('summary'),
    originalButton = new Node('button'),
    filter = new Node('section', 'bi-filter-studio'),
    inbox = new Node('details', 'ncx-inbox-panel');
  let originalClicked = 0,
    originalRenders = 0;
  originalButton.onclick = () => originalClicked++;
  box.append(summary, originalButton, filter, inbox);
  const page = new Node('div'),
    main = new Node('main');
  main.append(page);
  const calls = [],
    toasts = [];
  const context = {
    window: {
      BIWorkflow: model,
      WorkbenchNavigation: navigation,
      bi: {
        navigate: (section) => navigations.push(section),
        request: async (request) => {
          requests.push(structuredClone(request));
          const b = request.body;
          if (b.action === 'read' && options.deferRead)
            return new Promise((resolve) => {
              releaseRead = () =>
                resolve({ ok: true, value: { revision, data: structuredClone(saved) } });
            });
          if (b.action === 'save') {
            assert.equal(b.expectedRevision, revision);
            saved = model.preferences(b.data);
            revision++;
          }
          return { ok: true, value: { revision, data: structuredClone(saved) } };
        },
      },
      addEventListener() {},
    },
    document: {
      createElement: (tag) => new Node(tag),
      getElementById: (id) => (id === 'page' ? page : nodes.find((n) => n.id === id)),
      addEventListener: (name, fn) => events.set(name, fn),
    },
    S: { cfg: null, page: 'daily' },
    biPanel: () => box,
    dailyImportPanel: () => new Node('details'),
    dailyFilters: () => new Node('section'),
    D: {
      q: { scope: 'Synthetic A', start: '2026-10-29', end: '2026-10-30', status: 'Scrap' },
      key: 'same',
      result: {},
      working: false,
    },
    TR: {
      dirty: false,
      pending: false,
      resultKey: 'same',
      result: { query: { start: '2026-10-01', end: '2026-10-30' } },
    },
    dkey: () => 'same',
    trendKey: () => 'same',
    trendQuery: () => ({}),
    dailyAnalyze: async () => calls.push('dailyAnalyze'),
    dailyExport: async () => calls.push('dailyExport'),
    loadTrend: async () => calls.push('loadTrend'),
    render() {
      originalRenders++;
    },
    go: (section) => {
      context.S.page = section;
    },
    queueMicrotask: (fn) => microtasks.push(fn),
    setTimeout: () => 1,
    clearTimeout() {},
    toast: (message) => toasts.push(message),
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../desktop/bi-workflow-ui.js'), 'utf8'),
    context,
  );
  return {
    context,
    box,
    originalButton,
    filter,
    inbox,
    events,
    requests,
    navigations,
    microtasks,
    page,
    nodes,
    calls,
    toasts,
    releaseRead: () => releaseRead(),
    clicked: () => originalClicked,
    rendered: () => originalRenders,
  };
}
test('local extension receipt retains its controls and remembers disclosure state', async () => {
  const h = domHarness();
  const wrapped = h.context.biPanel();
  assert.ok(wrapped.children.includes(h.inbox));
  assert.equal(wrapped.children.some((n) => n.classes.has('bi-script-alternative')), false);
  while (h.microtasks.length) await h.microtasks.shift()();
  wrapped.open = true;
  wrapped.listeners.get('toggle')();
  await h.context.window.BIWorkflowMemory.flush();
  const write = h.requests.find((r) => r.body.action === 'save');
  assert.equal(write.body.data.acquisitionOpen, true);
  assert.equal(write.route, '/fusion/workflow-memory');
  assert.deepEqual(Object.keys(write.body.data).sort(), ['acquisitionOpen', 'scriptOpen']);
});
test('internal BI navigation synchronizes once and ribbon inputs are not destroyed while typing', () => {
  const h = domHarness();
  h.context.go('people');
  h.context.go('people');
  assert.deepEqual(h.navigations, ['people']);
  h.events.get('input')({ target: 'ribbon-select' });
  assert.equal(h.microtasks.length, 0);
  h.events.get('change')({ target: 'page-field' });
  assert.equal(h.microtasks.length, 1);
});
test('daily toolbar uses the original analysis/export functions and opens the real import panel', async () => {
  const h = domHarness();
  const imported = h.context.dailyImportPanel();
  h.page.append(imported);
  h.context.S.cfg = {};
  h.context.render();
  const ribbon = h.nodes.find((n) => n.id === 'bi-workflow-ribbon');
  const button = (label) => ribbon.querySelectorAll('button').find((b) => b.textContent === label);
  await button('1　导入数据').click();
  assert.equal(imported.open, true);
  assert.equal(imported.scrolled, true);
  await button('3　更新分析').click();
  await button('4　导出日报素材').click();
  assert.deepEqual(h.calls, ['dailyAnalyze', 'dailyExport']);
  const shortcuts = h.nodes.find((n) => n.id === 'bi-workflow-shortcuts');
  assert.equal(shortcuts.open, false);
  const select = shortcuts.children[1].children.find((n) => n.tagName === 'SELECT');
  assert.equal(
    select.children.filter((n) => n.tagName === 'OPTGROUP').flatMap((g) => g.children).length,
    14,
  );
});
test('trend toolbar forwards to the native export button and honors its disabled state', async () => {
  const h = domHarness();
  h.context.S.cfg = {};
  h.context.S.page = 'trends';
  const native = h.context.document.createElement('button');
  native.textContent = '导出当前趋势 Excel';
  native.disabled = true;
  native.onclick = () => h.calls.push('nativeTrendExport');
  h.page.append(native);
  h.context.render();
  const ribbon = h.nodes.find((n) => n.id === 'bi-workflow-ribbon');
  const action = ribbon.querySelectorAll('button').find((b) => b.textContent === '4　导出当前趋势');
  await action.click();
  assert.deepEqual(h.calls, []);
  assert.equal(h.toasts.length, 1);
  native.disabled = false;
  await action.click();
  assert.deepEqual(h.calls, ['nativeTrendExport']);
});
test('late layout restore merges only touched flags and never rebuilds live BI form controls', async () => {
  const h = domHarness({ initial: { acquisitionOpen: false, scriptOpen: true }, deferRead: true });
  const box = h.context.biPanel();
  const loading = h.microtasks.shift()();
  box.open = true;
  box.listeners.get('toggle')();
  h.releaseRead();
  await loading;
  await h.context.window.BIWorkflowMemory.flush();
  const saved = h.requests.find((r) => r.body.action === 'save');
  assert.equal(saved.body.data.acquisitionOpen, true);
  assert.equal(
    saved.body.data.scriptOpen,
    true,
    'untouched stored disclosure must survive a pending user toggle',
  );
  assert.equal(h.rendered(), 0, 'layout restore must not invoke the native full-page renderer');
});
