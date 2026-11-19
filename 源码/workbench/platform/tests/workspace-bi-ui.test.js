'use strict';
// DOM-model regression. Does not claim actual Windows/browser visual acceptance.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const Q = require('../domain/workspace-query');
function harness(options = {}) {
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this._text = '';
      this.dataset = {};
      this.classList = { toggle() {}, add() {}, remove() {} };
      this.style = { setProperty() {} };
    }
    set textContent(v) {
      this._text = String(v);
      this.children = [];
    }
    get textContent() {
      return this._text + this.children.map((c) => c.textContent).join('');
    }
    append(...nodes) {
      for (const n of nodes) {
        n.parent = this;
        this.children.push(n);
      }
    }
    prepend(...nodes) {
      for (const n of nodes) n.parent = this;
      this.children.unshift(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = [];
      this._text = '';
      this.append(...nodes);
    }
    setAttribute(k, v) {
      this[k] = v;
    }
    removeAttribute(k) {
      delete this[k];
    }
    add(n) {
      this.append(n);
    }
    focus() {}
    get isConnected() {
      return this === body || !!this.parent?.isConnected;
    }
    querySelectorAll(selector) {
      const tags = selector.split(',');
      return this.children.flatMap(walk).filter((n) => tags.includes(n.tagName));
    }
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
      this.onclose?.();
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
    }
  }
  const body = new Element('body'),
    walk = (n) => [n, ...n.children.flatMap(walk)],
    all = () => walk(body);
  const document = {
    body,
    createElement: (t) => new Element(t),
    createElementNS: (_ns, t) => new Element(t),
    getElementById: (id) => all().find((n) => n.id === id),
    querySelector: () => appShell,
  };
  const appShell = new Element('div');
  body.append(appShell);
  const charts = [],
    clicks = [],
    calls = [];
  const G = {
    fmt: (v) => (v == null ? '—' : String(v)),
    empty: (text) => Object.assign(new Element('p'), { textContent: text }),
    combo: () => new Element('manual-chart'),
    donut: (_items, _total, fn) => {
      clicks.push(fn);
      return new Element('donut');
    },
    ranking: (_items, o) => {
      clicks.push(o.onSelect);
      return new Element('rank');
    },
  };
  const report = (id, start = '2026-10-04', end = '2026-11-02') => {
    const bi = {
      grouping: options.product ? { kind: 'productType' } : { kind: 'process' },
      state: options.missing ? 'out-of-range' : 'available',
      hasData: true,
      quantity: id === 'one' ? 1919 : 7,
      rowCount: 1,
      previousQuantity: null,
      unitLabel: '次',
      sourceName: 'BI不良数据',
      availableRowCount: 1,
      availableRange: { start: '2026-10-16', end: '2026-10-16' },
      range: { start, end },
      coverageDays: 1,
      message: '当前日期没有覆盖已有数据',
      trend: [
        {
          key: '2026-10-16',
          start: '2026-10-16',
          end: '2026-10-16',
          quantity: id === 'one' ? 1919 : 7,
          covered: 1,
          days: 1,
        },
      ],
      issues: [{ value: '装管反', count: 1919 }],
      processes: [{ value: '装管', count: 1919 }],
      employees: [{ value: '合成员工', count: 1919 }],
      rows: [
        {
          date: '2026-10-16',
          issue: '装管反',
          quantity: 1919,
          process: '装管',
          employee: '合成员工',
          reporter: '合成报检人',
          shift: '晚班',
          sn: '0012',
        },
      ],
    };
    if (options.gaps) {
      const point = bi.trend[0];
      bi.trend = [
        {
          ...point,
          key: '2026-10-15',
          start: '2026-10-15',
          end: '2026-10-15',
          quantity: null,
          covered: 0,
        },
        point,
        {
          ...point,
          key: '2026-10-17',
          start: '2026-10-17',
          end: '2026-10-17',
          quantity: null,
          covered: 0,
        },
      ];
    }
    return {
      scope: { start, end },
      recordCount: 0,
      pending: 0,
      overdue: 0,
      workflowAvailable: false,
      trend: [],
      primary: { source: 'bi', available: !options.missing },
      biSource: bi,
    };
  };
  const items = ['one', 'two'].map((id, i) => ({
    id,
    name: i ? '第二工作区' : '已有BI工作区',
    state: 'ready',
    dataSourceMode: options.records ? 'records' : options.explicit ? 'bi' : 'auto',
    createdAt: 1,
    lastUsed: 1,
    process: '',
    color: 'blue',
    analysis: { ...Q.normalize({}), range: '30' },
    summary: Q.summary(report(id)),
  }));
  const deletedItems = [];
  let activeId = options.activeId || '';
  async function api(method, input) {
    calls.push({ method, input });
    if (method === 'managedList')
      return { items, deletedItems, activeId, layout: { selectedId: 'one', view: 'cards', sort: 'recent' } };
    if (method === 'managedReport') return report(input.id, input.start, input.end);
    if (method === 'managedLayout') return {};
    if (method === 'managedOpen')
      return {
        managedId: input.id,
        dataSourceMode: items.find((x) => x.id === input.id).dataSourceMode,
      };
    if (method === 'managedUpdate') {
      const item = items.find((x) => x.id === input.id);
      Object.assign(item, input);
      return item;
    }
    if (method === 'managedDelete') {
      if (options.deleteFailure) throw Error('合成删除保存失败');
      const index = items.findIndex((item) => item.id === input.id);
      const item = items.splice(index, 1)[0];
      item.deletedAt = 1790000000000;
      item.archived = true;
      deletedItems.push(item);
      if (activeId === item.id) activeId = '';
      return item;
    }
    if (method === 'managedRecover') {
      const index = deletedItems.findIndex((item) => item.id === input.id);
      const item = deletedItems.splice(index, 1)[0];
      delete item.deletedAt;
      item.archived = false;
      items.push(item);
      return item;
    }
    throw Error('Unexpected ' + method);
  }
  const context = {
    window: {
      WorkspaceQuery: Q,
      HomeGraphics: G,
      BIFieldLabels: require('../desktop/app/bi-field-labels'),
      ChartSurface: {
        create: (opts) => {
          charts.push(opts);
          return new Element('chart');
        },
      },
      dispatchEvent() {},
      confirm(message) {
        calls.push({ method: 'confirm', message });
        return options.confirm !== false;
      },
      chooseWorkspaceSource: async () => {
        calls.push({ method: 'sourceChoice' });
        return options.cancelChoice ? null : 'bi';
      },
    },
    document,
    Option: class extends Element {
      constructor(label, value) {
        super('option');
        this.textContent = label;
        this.value = value;
      }
    },
    structuredClone,
    CustomEvent: class {},
    MutationObserver: class {
      observe() {}
    },
    console,
  };
  vm.createContext(context);
  for (const name of ['workspace-bi-view.js', 'workspace-manager.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../desktop/app', name), 'utf8'), context);
  const manager = context.window.createWorkspaceManager({
    api,
    onOpen: async (status, route, options) =>
      calls.push({ method: 'onOpen', status, route, options }),
    onOldFile() {},
    onDemo() {},
    beforeLeave: async () => calls.push({ method: 'beforeLeave' }),
  });
  return { manager, body, all, charts, clicks, calls };
}
test('legacy-auto workspace cards and right preview show actual BI counts, units, charts and distinct personnel labels', async () => {
  const h = harness();
  await h.manager.open();
  assert.ok(h.body.textContent.includes('工作区不良数据预览 · BI自由分析'));
  assert.ok(h.body.textContent.includes('1919'));
  assert.ok(!h.body.textContent.includes('人工记录与检验预览'));
  assert.ok(h.body.textContent.includes('旧工作区自动识别'));
  assert.ok(h.body.textContent.includes('BI责任员工'));
  assert.ok(h.body.textContent.includes('报检人'));
  assert.equal(h.charts[0].series[0].values[0], 1919);
  assert.equal(h.charts[0].unit, '次');
  h.charts[0].onPoint(0, 0);
  await new Promise((r) => setImmediate(r));
  const detail = h.calls.find(
    (x) => x.method === 'managedReport' && x.input.start === '2026-10-16',
  );
  assert.equal(detail.input.id, 'one');
  assert.equal(detail.input.pageSize, 50);
  h.clicks[2]('合成员工');
  await new Promise((r) => setImmediate(r));
  assert.ok(
    h.calls.some(
      (x) =>
        x.method === 'managedReport' &&
        x.input.biFilter?.field === 'employee' &&
        x.input.biFilter.value === '合成员工',
    ),
  );
});
test('explicit BI workspace has a real preview and date controls, rather than only navigation buttons', async () => {
  const h = harness({ explicit: true });
  await h.manager.open();
  assert.equal(h.charts.length, 1);
  assert.ok(h.all().some((n) => n.tagName === 'input' && n.type === 'date'));
  const second = h.all().find((n) => n.tagName === 'button' && n.textContent === '第二工作区');
  await second.onclick();
  assert.equal(h.charts.at(-1).series[0].values[0], 7);
});
test('out-of-range BI shows missing values and an all-dates recovery action, without zero charts', async () => {
  const h = harness({ missing: true });
  await h.manager.open();
  assert.equal(h.charts.length, 0);
  assert.ok(h.body.textContent.includes('当前日期没有覆盖已有数据'));
  const all = h.all().find((n) => n.tagName === 'button' && n.textContent === '查看全部已有BI日期');
  assert.ok(all);
  await all.onclick();
  assert.ok(h.calls.some((x) => x.method === 'managedUpdate' && x.input.analysis.range === 'all'));
});
test('the only available BI day is immediately visible instead of hidden behind leading empty dates', async () => {
  const h = harness({ gaps: true });
  await h.manager.open();
  assert.equal(h.charts[0].labels.length, 1);
  assert.equal(h.charts[0].series[0].values[0], 1919);
  assert.ok(h.body.textContent.includes('当前仅1个有数据周期'));
});
test('workspace BI chart and table use product type when the saved grouping is a product family', async () => {
  const h = harness({ product: true });
  await h.manager.open();
  assert.ok(h.body.textContent.includes('产品类型不良分布'));
  assert.ok(!h.body.textContent.includes('工序不良分布'));
  assert.ok(h.all().some((n) => n.tagName === 'th' && n.textContent === '产品类型'));
});

test('BI workspace settings hide recording fields, defaults and scan rules; manual workspace retains them', async () => {
  const bi = harness({ explicit: true });
  await bi.manager.open();
  const tabs = bi
    .all()
    .filter((n) => n.role === 'tab')
    .map((n) => n.textContent);
  assert.deepEqual(tabs, ['数据分析预览', '基本信息', '数据源与字段', '其他设置']);
  const source = bi.all().find((n) => n.role === 'tab' && n.textContent === '数据源与字段');
  await source.onclick();
  const configure = bi
    .all()
    .find((n) => n.tagName === 'button' && n.textContent === '配置BI数据源与导入');
  await configure.onclick();
  const opened = bi.calls.find((n) => n.method === 'onOpen');
  assert.equal(opened.route, 'analysis-studio');
  assert.equal(opened.options.analysisTab, 'sources');
  assert(!bi.calls.some((n) => n.method === 'managedFields'));
  const manual = harness({ records: true });
  await manual.manager.open();
  const manualTabs = manual
    .all()
    .filter((n) => n.role === 'tab')
    .map((n) => n.textContent);
  assert(manualTabs.includes('字段配置'));
  assert(manualTabs.includes('默认设置'));
  assert(manualTabs.includes('扫码规则'));
  assert(!manualTabs.includes('数据源与字段'));
});

test('old workspace asks for source once before opening, saves the choice, and cancellation leaves it closed', async () => {
  const h = harness();
  await h.manager.open();
  await h
    .all()
    .find((n) => n.tagName === 'button' && n.textContent === '打开')
    .onclick();
  assert.equal(h.calls.filter((x) => x.method === 'sourceChoice').length, 1);
  const update = h.calls.find((x) => x.method === 'managedUpdate');
  assert.equal(update.input.dataSourceMode, 'bi');
  assert.equal(h.calls.find((x) => x.method === 'onOpen').status.dataSourceMode, 'bi');
  const cancel = harness({ cancelChoice: true });
  await cancel.manager.open();
  await cancel
    .all()
    .find((n) => n.tagName === 'button' && n.textContent === '打开')
    .onclick();
  assert(!cancel.calls.some((x) => x.method === 'managedOpen' || x.method === 'managedUpdate'));
});

test('BI creation hides and disables the manual template selector', async () => {
  const h = harness({ explicit: true });
  await h.manager.open();
  await h
    .all()
    .find((n) => n.tagName === 'button' && n.textContent === '＋ 新建工作区')
    .onclick();
  const mode = h.all().find((n) => n['aria-label'] === '主要数据来源（必选）');
  const template = h.all().find((n) => n['aria-label'] === '录入模板来源（不含BI数据和BI配置）');
  mode.value = 'bi';
  mode.onchange();
  assert.equal(template.disabled, true);
  assert.equal(template.parent.hidden, true);
  mode.value = 'records';
  mode.onchange();
  assert.equal(template.disabled, false);
  assert.equal(template.parent.hidden, false);
});

test('workspace delete is discoverable, confirms its name, and can be recovered from the bin', async () => {
  const h = harness({ explicit: true, activeId: 'one' });
  await h.manager.open();
  const remove = () => h.all().find((node) => node['aria-label'] === '删除工作区：已有BI工作区');
  assert.equal(remove().textContent, '删除');
  await remove().onclick();
  assert(h.calls.find(({ method }) => method === 'confirm').message.includes('已有BI工作区'));
  assert(h.calls.find(({ method }) => method === 'confirm').message.includes('可随时恢复'));
  assert(h.calls.findIndex(({ method }) => method === 'beforeLeave') <
    h.calls.findIndex(({ method }) => method === 'managedDelete'));
  assert(!remove(), 'deleted entry is removed from the normal card list');
  assert(h.body.textContent.includes('已删除「已有BI工作区」'));
  await h.all().find((node) => node.tagName === 'button' && node.textContent === '回收站（1）').onclick();
  const reportCalls = h.calls.filter(({ method }) => method === 'managedReport').length;
  assert(h.body.textContent.includes('此工作区已移入回收站'));
  assert(!h.all().some((node) => node.tagName === 'button' && node.textContent === '打开'));
  assert(!h.all().some((node) => node['aria-label'] === '收藏已有BI工作区'));
  await h.all().find((node) => node.tagName === 'button' && node.textContent === '查看保留信息').onclick();
  assert.equal(h.calls.filter(({ method }) => method === 'managedReport').length, reportCalls,
    'recycle-bin selection does not load or edit the deleted workspace');
  await h.all().find((node) => node.tagName === 'button' && node.textContent === '恢复工作区').onclick();
  assert(remove());
  assert(h.body.textContent.includes('已恢复「已有BI工作区」'));
  assert(h.all().some((node) => node.textContent === '回收站（0）'));
});

test('cancelled or failed workspace deletion leaves its card available', async () => {
  for (const options of [{ confirm: false }, { deleteFailure: true }]) {
    const h = harness({ explicit: true, ...options });
    await h.manager.open();
    const remove = h.all().find((node) => node['aria-label'] === '删除工作区：已有BI工作区');
    await remove.onclick();
    assert(h.all().some((node) => node['aria-label'] === '删除工作区：已有BI工作区'));
    if (options.confirm === false) assert(!h.calls.some(({ method }) => method === 'managedDelete'));
    else assert(h.body.textContent.includes('合成删除保存失败'));
  }
});
