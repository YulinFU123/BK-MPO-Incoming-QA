'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const APP = path.resolve(__dirname, '../..');
const SOURCE_TRENDS = path.join(APP, 'bi/ui/trends.js');
const PACKAGED_TRENDS = path.join(APP, 'bi-ui/trends.js');
const SOURCE_FUSION = path.join(APP, 'platform/desktop/bi-fusion.js');
const PACKAGED_FUSION = path.join(APP, 'bi-ui/fusion.js');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('handoff sources and packaged BI UI stay in sync', () => {
  assert.equal(sha(SOURCE_TRENDS), sha(PACKAGED_TRENDS), '重跑 prepare-bi.js 会覆盖 trends.js，两个副本必须一致');
  assert.equal(sha(SOURCE_FUSION), sha(PACKAGED_FUSION), 'fusion.js 由 platform/desktop/bi-fusion.js 生成');
  const worker = fs.readFileSync(path.join(APP, 'platform/desktop/bi-worker.py'), 'utf8');
  const panel = fs.readFileSync(path.join(APP, 'bi/panel.py'), 'utf8');
  assert.match(worker, /'\/api\/analytics\/detail'/);
  assert.match(panel, /p == "\/api\/analytics\/detail"/);
  assert.match(fs.readFileSync(SOURCE_FUSION, 'utf8'), /onPoint:/);
});

class El {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.open = false;
    this._listeners = {};
    this.classList = { add() {}, remove() {} };
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key]; }
  append(...kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      this.children.push(kid);
    }
    return this;
  }
  replaceChildren(...kids) { this.children = []; return this.append(...kids); }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  dispatch(type, extra = {}) {
    for (const fn of this._listeners[type] || [])
      fn({ type, preventDefault() {}, stopPropagation() {}, target: this, ...extra });
  }
  showModal() { this.open = true; }
  close() {
    this.open = false;
    for (const fn of this._listeners.close || []) fn({ type: 'close' });
  }
  remove() { this.removed = true; }
  querySelector() { return null; }
}
function h(tag, attrs, ...kids) {
  const el = new El(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  return el.append(...kids);
}
function all(node, out = []) {
  out.push(node);
  if (node && Array.isArray(node.children)) for (const kid of node.children) all(kid, out);
  return out;
}
function findText(node, text) {
  return all(node).find((item) =>
    (typeof item === 'string' && item.includes(text)) ||
    (item && typeof item === 'object' && item.children?.some((kid) => kid === text)),
  );
}

function loadTrends(apiImpl) {
  const body = new El('body');
  const calls = [];
  const context = {
    document: {
      createElementNS: (_ns, tag) => new El(tag),
      createElement: (tag) => new El(tag),
      body,
      querySelector: () => null,
    },
    h,
    console,
    S: { cfg: { analytics: { query: {}, presets: [] } }, scan: null, page: 'trends' },
    PAGES: {},
    $: () => null,
    fmt: (value) => (value == null ? '' : String(value)),
    clone: (value) => JSON.parse(JSON.stringify(value)),
    toast: (message) => calls.push({ toast: message }),
    banner: (_type, message) => h('div', { class: 'banner' }, message),
    empty: (message) => h('div', {}, message),
    card: () => h('div', {}),
    kpi: () => h('div', {}),
    icon: () => h('span', {}),
    seg: () => h('div', {}),
    field: () => h('div', {}),
    inp: () => h('input', {}),
    sel: () => h('select', {}),
    tags: () => h('div', {}),
    chips: () => h('div', {}),
    uniq: (values) => values,
    splitv: () => [],
    peopleGroups: () => [],
    go() {}, touch() {}, scan() {}, busy() {},
    api: async (route, bodyArg) => {
      calls.push({ route, body: bodyArg });
      return apiImpl(route, bodyArg);
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SOURCE_TRENDS, 'utf8'), context, { filename: SOURCE_TRENDS });
  vm.runInContext(
    'TR.result = {ok:true, empty:false}; TR.dirty = false; TR.resultKey = trendKey();',
    context,
  );
  return { context, body, calls };
}

const periods = [
  { label: '2026-01-01', start: '2026-01-01', end: '2026-01-01', quantity: 10 },
  { label: '2026-01-02', start: '2026-01-02', end: '2026-01-02', quantity: 20 },
];

test('clicking a single-series SVG point requests the whole period', () => {
  const { context } = loadTrends(() => ({}));
  const clicked = [];
  context.openTrendDetail = (focus, label) => clicked.push({ focus, label });
  const chart = context.trendChart(periods, [{ name: '筛选内不良记录 pcs', values: [10, 20] }]);
  const circles = chart.children
    .filter((node) => node.tagName === 'svg')
    .flatMap((svg) => svg.children.filter((node) => node.tagName === 'circle'));
  assert.equal(circles.length, 2);
  circles[1].dispatch('click');
  // The focus object is created inside the VM realm; compare fields rather
  // than prototypes so the assertion does not depend on cross-realm identity.
  assert.equal(clicked[0].focus.type, 'period');
  assert.equal(clicked[0].focus.index, 1);
  assert.match(clicked[0].label, /2026-01-02/);
});

test('clicking a comparison SVG point keeps both the period and the series', () => {
  const { context } = loadTrends(() => ({}));
  const clicked = [];
  context.openTrendDetail = (focus) => clicked.push(focus);
  const chart = context.trendChart(periods, [
    { name: '装管', values: [10, 20] },
    { name: '切纤', values: [5, 8] },
  ]);
  const circles = chart.children
    .filter((node) => node.tagName === 'svg')
    .flatMap((svg) => svg.children.filter((node) => node.tagName === 'circle'));
  circles[2].dispatch('click');
  assert.ok(clicked.some((focus) => focus.type === 'series' && focus.series === 1));
});

test('the drawer renders detail rows, paginates and never changes the main filter', async () => {
  const detail = {
    ok: true, empty: false, title: '周期明细', total: 30, page: 1, pages: 2, pageSize: 25,
    totalQuantity: 60, note: '来源说明',
    columns: [{ key: 'date', label: '业务日期' }, { key: 'file', label: '来源文件' }],
    rows: [{ date: '2026-01-01', file: 'd1.xlsx' }],
  };
  const { context, body, calls } = loadTrends((route) =>
    route === '/api/analytics/detail' ? { ...detail, page: calls.at(-1).body.page } : {},
  );
  const before = JSON.stringify(context.S.cfg.analytics.query);
  await context.openTrendDetail({ type: 'period', index: 0 }, '2026-01-01 · 明细');
  const dialog = body.children.find((node) => node.tagName === 'dialog');
  assert.ok(dialog && dialog.open, '明细抽屉应打开');
  const request = calls.find((item) => item.route === '/api/analytics/detail');
  assert.deepEqual(request.body.focus, { type: 'period', index: 0 });
  assert.equal(request.body.page, 1);
  assert.ok(all(dialog).some((node) => node === 'd1.xlsx'), '应渲染来源文件');
  assert.equal(JSON.stringify(context.S.cfg.analytics.query), before, '主筛选不得被修改');

  const next = all(dialog).find((node) => node.children?.includes('下一页'));
  assert.ok(next, '应提供下一页');
  next.dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));
  const paged = calls.filter((item) => item.route === '/api/analytics/detail').at(-1);
  assert.equal(paged.body.page, 2);
  dialog.close();
  assert.equal(dialog.removed, true, '关闭后抽屉应移除');
});

test('stale results refuse to open a drawer and ask for a refresh', async () => {
  const { context, body, calls } = loadTrends(() => ({}));
  vm.runInContext('TR.dirty = true;', context);
  await context.openTrendDetail({ type: 'period', index: 0 }, '旧数据');
  assert.equal(body.children.length, 0);
  assert.ok(calls.some((item) => item.toast && item.toast.includes('更新分析')));
});
